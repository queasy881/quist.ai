"""Tool definitions and execution for Claude Code clone."""

import os
import subprocess
import json
import shutil
import glob as globmod
import platform
import psutil
import datetime
import base64
import time
import threading
import requests as req

# Current working directory (mutable)
CWD = os.getcwd()

# Discord state
_discord = {"token": None, "username": None, "discriminator": None, "user_id": None}

# Recording state
_recording = {"active": False, "process": None, "path": None, "start_time": None}

# Ask user state — blocks tool execution until user responds
_ask_event = threading.Event()
_ask_answer = {"value": None}

# Callback set by app.py to push questions to the UI
_ask_ui_callback = None

def set_ask_callback(cb):
    global _ask_ui_callback
    _ask_ui_callback = cb

def submit_user_answer(answer: str):
    """Called from app.py when the user picks an option or types a custom answer."""
    _ask_answer["value"] = answer
    _ask_event.set()

TOOL_DEFINITIONS = [
    {"name":"read_file","description":"Read file(s). Use start_line/end_line if >300 lines. Pass 'paths' array to read multiple files in one call.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"paths":{"type":"array","items":{"type":"string"},"description":"Multiple file paths to read at once."},"start_line":{"type":"integer"},"end_line":{"type":"integer"}},"required":[]}},
    {"name":"write_file","description":"Write/create file(s). Auto-creates parent dirs. Pass 'files' array of {path,content} to write multiple files in one call.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"files":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]},"description":"Multiple files to write at once."}},"required":[]}},
    {"name":"edit_file","description":"Edit multiple sections of a file at once. Pass array of {old_text, new_text} replacements.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"old_text":{"type":"string"},"new_text":{"type":"string"}},"required":["old_text","new_text"]}}},"required":["path","edits"]}},
    {"name":"run_command","description":"Run shell command (cmd/powershell).",
     "input_schema":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}},
    {"name":"cd","description":"Change working directory.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
    {"name":"create_folder","description":"Create directory (and parents).",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
    {"name":"create_directory","description":"Alias for create_folder.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
    {"name":"list_files","description":"List directory contents with sizes.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":[]}},
    {"name":"search_files","description":"Grep: search text/regex across files recursively.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"pattern":{"type":"string"},"file_pattern":{"type":"string"},"max_results":{"type":"integer"}},"required":["pattern"]}},
    {"name":"replace_in_file","description":"Find/replace text in file.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"old_text":{"type":"string"},"new_text":{"type":"string"},"count":{"type":"integer"}},"required":["path","old_text","new_text"]}},
    {"name":"move_file","description":"Move/rename file or folder.",
     "input_schema":{"type":"object","properties":{"source":{"type":"string"},"destination":{"type":"string"}},"required":["source","destination"]}},
    {"name":"copy_file","description":"Copy file or directory (recursive for dirs).",
     "input_schema":{"type":"object","properties":{"source":{"type":"string"},"destination":{"type":"string"}},"required":["source","destination"]}},
    {"name":"delete_file","description":"Delete file/dir. recursive=true for non-empty dirs.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"recursive":{"type":"boolean"}},"required":["path"]}},
    {"name":"get_file_info","description":"File metadata: size, dates, extension.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
    {"name":"find_files","description":"Glob search for files recursively. e.g. '**/*.py'.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"},"pattern":{"type":"string"},"max_results":{"type":"integer"}},"required":["pattern"]}},
    {"name":"open_url","description":"Open URL in default browser.",
     "input_schema":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}},
    {"name":"open_file","description":"Open file with default app.",
     "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}},
    {"name":"get_system_info","description":"OS, CPU, RAM, disk, Python version.",
     "input_schema":{"type":"object","properties":{},"required":[]}},
    {"name":"clipboard_read","description":"Read clipboard text.",
     "input_schema":{"type":"object","properties":{},"required":[]}},
    {"name":"clipboard_write","description":"Write text to clipboard.",
     "input_schema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}},
    {"name":"process_list","description":"List running processes. Optional name filter.",
     "input_schema":{"type":"object","properties":{"filter":{"type":"string"},"max_results":{"type":"integer"}},"required":[]}},
    {"name":"kill_process","description":"Kill process by PID or name.",
     "input_schema":{"type":"object","properties":{"pid":{"type":"integer"},"name":{"type":"string"}},"required":[]}},
    {"name":"ask_user","description":"Ask user a question with 2-3 options + free text. Blocks until answered. Use when unsure.",
     "input_schema":{"type":"object","properties":{"question":{"type":"string"},"option1":{"type":"string"},"option2":{"type":"string"},"option3":{"type":"string"}},"required":["question","option1","option2"]}},
    {"name":"screenshot","description":"Capture screen. mode='full'|'region'. Region needs x,y,width,height.",
     "input_schema":{"type":"object","properties":{"mode":{"type":"string"},"x":{"type":"integer"},"y":{"type":"integer"},"width":{"type":"integer"},"height":{"type":"integer"},"save_path":{"type":"string"}},"required":[]}},
    {"name":"record_screen","description":"Record screen. action='start'|'stop'. Optional: duration (seconds), format='mp4'|'gif'.",
     "input_schema":{"type":"object","properties":{"action":{"type":"string"},"duration":{"type":"integer"},"format":{"type":"string"},"save_path":{"type":"string"}},"required":["action"]}
    },
    {"name":"discord_login","description":"Login with user's Discord token. Check discord_status first.",
     "input_schema":{"type":"object","properties":{"token":{"type":"string"}},"required":["token"]}},
    {"name":"discord_status","description":"Check Discord login state. Call FIRST before any discord op.",
     "input_schema":{"type":"object","properties":{},"required":[]}},
    {"name":"discord_friends","description":"List servers the account is in.",
     "input_schema":{"type":"object","properties":{},"required":[]}},
    {"name":"discord_dms","description":"List DM conversations with user IDs. Use to find users before sending.",
     "input_schema":{"type":"object","properties":{"filter":{"type":"string"}},"required":[]}},
    {"name":"discord_send","description":"Send DM message/file. Use username (searches DMs) or user_id.",
     "input_schema":{"type":"object","properties":{"user_id":{"type":"string"},"username":{"type":"string"},"message":{"type":"string"},"file_path":{"type":"string"}},"required":[]}},
    {"name":"discord_channels","description":"List channels in a server.",
     "input_schema":{"type":"object","properties":{"server_id":{"type":"string"},"server_name":{"type":"string"}},"required":[]}}
]


def resolve_path(path: str) -> str:
    """Resolve a path relative to the current working directory."""
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(CWD, path))


def _fmt_size(size):
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size/1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size/(1024*1024):.1f} MB"
    else:
        return f"{size/(1024*1024*1024):.2f} GB"


def execute_tool(name: str, input_data: dict) -> str:
    """Execute a tool by name with given input. Returns result string."""
    global CWD

    try:
        # ── ORIGINAL TOOLS ──

        if name == "read_file":
            # Batch mode: read multiple files at once
            paths = input_data.get("paths") or ([input_data["path"]] if input_data.get("path") else [])
            if not paths:
                return "Error: Provide 'path' or 'paths'."

            results = []
            for p in paths:
                fpath = resolve_path(p)
                if not os.path.exists(fpath):
                    results.append(f"── {fpath} ──\nError: File not found"); continue
                if not os.path.isfile(fpath):
                    results.append(f"── {fpath} ──\nError: Not a file"); continue

                with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()

                total = len(lines)
                start = input_data.get("start_line")
                end = input_data.get("end_line")

                if start is not None or end is not None:
                    s = max(1, start or 1) - 1
                    e = min(total, end or total)
                    content = "".join(f"{i}\t{line}" for i, line in enumerate(lines[s:e], start=s+1))
                    results.append(f"── {fpath} (lines {s+1}-{e} of {total}) ──\n{content}")
                elif total > 300:
                    results.append(f"── {fpath} ──\n{total} lines. Too large — use start_line/end_line (e.g. 1-300).")
                else:
                    content = "".join(f"{i}\t{line}" for i, line in enumerate(lines, start=1))
                    results.append(f"── {fpath} ({total} lines) ──\n{content}")

            return "\n".join(results)

        elif name == "write_file":
            # Batch mode: write multiple files at once
            files = input_data.get("files")
            if files:
                results = []
                for f in files:
                    fpath = resolve_path(f["path"])
                    os.makedirs(os.path.dirname(fpath) if os.path.dirname(fpath) else ".", exist_ok=True)
                    with open(fpath, "w", encoding="utf-8") as fh:
                        fh.write(f["content"])
                    results.append(f"Wrote {len(f['content'])} chars → {fpath}")
                return "\n".join(results)
            else:
                path = resolve_path(input_data["path"])
                os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(input_data["content"])
                return f"Wrote {len(input_data['content'])} chars → {path}"

        elif name == "edit_file":
            path = resolve_path(input_data["path"])
            if not os.path.isfile(path):
                return f"Error: File not found: {path}"
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            results = []
            for edit in input_data.get("edits", []):
                old = edit["old_text"]
                new = edit["new_text"]
                count = content.count(old)
                if count == 0:
                    results.append(f"NOT FOUND: '{old[:60]}...'")
                else:
                    content = content.replace(old, new)
                    results.append(f"Replaced {count}x: '{old[:40]}...' → '{new[:40]}...'")
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"Edited {path}:\n" + "\n".join(results)

        elif name == "run_command":
            command = input_data["command"]
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=CWD,
                timeout=120
            )
            output = ""
            if result.stdout:
                output += result.stdout
            if result.stderr:
                output += ("\n" if output else "") + result.stderr
            if result.returncode != 0:
                output += f"\n[Exit code: {result.returncode}]"
            return output if output.strip() else "[Command completed with no output]"

        elif name == "cd":
            path = resolve_path(input_data["path"])
            if not os.path.exists(path):
                return f"Error: Directory not found: {path}"
            if not os.path.isdir(path):
                return f"Error: Not a directory: {path}"
            CWD = path
            return f"Changed working directory to: {CWD}"

        elif name in ("create_folder", "create_directory"):
            path = resolve_path(input_data["path"])
            os.makedirs(path, exist_ok=True)
            return f"Created directory: {path}"

        elif name == "list_files":
            path = resolve_path(input_data.get("path", "."))
            if not os.path.exists(path):
                return f"Error: Path not found: {path}"
            if not os.path.isdir(path):
                return f"Error: Not a directory: {path}"

            entries = []
            try:
                items = sorted(os.listdir(path))
            except PermissionError:
                return f"Error: Permission denied: {path}"

            for item in items:
                full = os.path.join(path, item)
                try:
                    if os.path.isdir(full):
                        entries.append(f"  [DIR]  {item}/")
                    else:
                        size = os.path.getsize(full)
                        entries.append(f"  [FILE] {item} ({_fmt_size(size)})")
                except OSError:
                    entries.append(f"  [????] {item}")

            header = f"Directory: {path}\nCWD: {CWD}\n{len(entries)} items:\n"
            return header + "\n".join(entries) if entries else header + "(empty)"

        # ── NEW POWER TOOLS ──

        elif name == "search_files":
            import re
            search_path = resolve_path(input_data.get("path", "."))
            pattern = input_data["pattern"]
            file_pattern = input_data.get("file_pattern", "*")
            max_results = input_data.get("max_results", 50)

            if not os.path.isdir(search_path):
                return f"Error: Not a directory: {search_path}"

            try:
                regex = re.compile(pattern, re.IGNORECASE)
            except re.error as e:
                return f"Error: Invalid regex: {e}"

            matches = []
            for root, dirs, files in os.walk(search_path):
                # Skip hidden dirs and common junk
                dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', '.git', 'venv')]
                for fname in files:
                    if file_pattern != "*":
                        import fnmatch
                        if not fnmatch.fnmatch(fname, file_pattern):
                            continue
                    fpath = os.path.join(root, fname)
                    try:
                        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                            for lineno, line in enumerate(f, 1):
                                if regex.search(line):
                                    rel = os.path.relpath(fpath, search_path)
                                    matches.append(f"  {rel}:{lineno}: {line.rstrip()}")
                                    if len(matches) >= max_results:
                                        break
                    except (OSError, UnicodeDecodeError):
                        continue
                    if len(matches) >= max_results:
                        break
                if len(matches) >= max_results:
                    break

            if not matches:
                return f"No matches found for '{pattern}' in {search_path}"
            header = f"Found {len(matches)} match(es) for '{pattern}':\n"
            return header + "\n".join(matches)

        elif name == "replace_in_file":
            path = resolve_path(input_data["path"])
            if not os.path.isfile(path):
                return f"Error: File not found: {path}"

            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()

            old_text = input_data["old_text"]
            new_text = input_data["new_text"]
            count = input_data.get("count")

            occurrences = content.count(old_text)
            if occurrences == 0:
                return f"Error: '{old_text[:80]}' not found in {path}"

            if count:
                new_content = content.replace(old_text, new_text, count)
                replaced = min(count, occurrences)
            else:
                new_content = content.replace(old_text, new_text)
                replaced = occurrences

            with open(path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return f"Replaced {replaced} occurrence(s) in {path}"

        elif name == "move_file":
            src = resolve_path(input_data["source"])
            dst = resolve_path(input_data["destination"])
            if not os.path.exists(src):
                return f"Error: Source not found: {src}"
            shutil.move(src, dst)
            return f"Moved: {src} → {dst}"

        elif name == "copy_file":
            src = resolve_path(input_data["source"])
            dst = resolve_path(input_data["destination"])
            if not os.path.exists(src):
                return f"Error: Source not found: {src}"
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                os.makedirs(os.path.dirname(dst) if os.path.dirname(dst) else ".", exist_ok=True)
                shutil.copy2(src, dst)
            return f"Copied: {src} → {dst}"

        elif name == "delete_file":
            path = resolve_path(input_data["path"])
            if not os.path.exists(path):
                return f"Error: Path not found: {path}"
            recursive = input_data.get("recursive", False)
            if os.path.isfile(path):
                os.remove(path)
                return f"Deleted file: {path}"
            elif os.path.isdir(path):
                if recursive:
                    shutil.rmtree(path)
                    return f"Deleted directory (recursive): {path}"
                else:
                    try:
                        os.rmdir(path)
                        return f"Deleted empty directory: {path}"
                    except OSError:
                        return f"Error: Directory not empty. Use recursive=true to delete: {path}"

        elif name == "get_file_info":
            path = resolve_path(input_data["path"])
            if not os.path.exists(path):
                return f"Error: Path not found: {path}"
            stat = os.stat(path)
            is_dir = os.path.isdir(path)
            info = [
                f"Path: {path}",
                f"Type: {'directory' if is_dir else 'file'}",
                f"Size: {_fmt_size(stat.st_size)}",
                f"Modified: {datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')}",
                f"Created: {datetime.datetime.fromtimestamp(stat.st_ctime).strftime('%Y-%m-%d %H:%M:%S')}",
            ]
            if not is_dir:
                _, ext = os.path.splitext(path)
                info.append(f"Extension: {ext if ext else '(none)'}")
            return "\n".join(info)

        elif name == "find_files":
            search_path = resolve_path(input_data.get("path", "."))
            pattern = input_data["pattern"]
            max_results = input_data.get("max_results", 100)

            if not os.path.isdir(search_path):
                return f"Error: Not a directory: {search_path}"

            results = []
            for match in globmod.iglob(os.path.join(search_path, pattern), recursive=True):
                rel = os.path.relpath(match, search_path)
                is_dir = os.path.isdir(match)
                if is_dir:
                    results.append(f"  [DIR]  {rel}/")
                else:
                    sz = _fmt_size(os.path.getsize(match))
                    results.append(f"  [FILE] {rel} ({sz})")
                if len(results) >= max_results:
                    break

            if not results:
                return f"No files matching '{pattern}' in {search_path}"
            return f"Found {len(results)} match(es) for '{pattern}':\n" + "\n".join(results)

        elif name == "open_url":
            import webbrowser
            url = input_data["url"]
            webbrowser.open(url)
            return f"Opened URL in browser: {url}"

        elif name == "open_file":
            path = resolve_path(input_data["path"])
            if not os.path.exists(path):
                return f"Error: File not found: {path}"
            os.startfile(path)
            return f"Opened file with default application: {path}"

        elif name == "get_system_info":
            info = []
            info.append(f"OS: {platform.system()} {platform.release()} ({platform.version()})")
            info.append(f"Architecture: {platform.machine()}")
            info.append(f"Processor: {platform.processor()}")
            info.append(f"CPU Cores: {psutil.cpu_count(logical=False)} physical, {psutil.cpu_count(logical=True)} logical")
            info.append(f"CPU Usage: {psutil.cpu_percent(interval=0.5)}%")
            mem = psutil.virtual_memory()
            info.append(f"RAM: {_fmt_size(mem.used)} / {_fmt_size(mem.total)} ({mem.percent}% used)")
            for part in psutil.disk_partitions():
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                    info.append(f"Disk {part.device}: {_fmt_size(usage.used)} / {_fmt_size(usage.total)} ({usage.percent}% used)")
                except (PermissionError, OSError):
                    pass
            info.append(f"Python: {platform.python_version()}")
            info.append(f"Username: {os.getlogin()}")
            info.append(f"Home: {os.path.expanduser('~')}")
            info.append(f"CWD: {CWD}")
            return "\n".join(info)

        elif name == "clipboard_read":
            # Use PowerShell to read clipboard (no extra deps)
            result = subprocess.run(
                ['powershell', '-command', 'Get-Clipboard'],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0:
                return f"Error reading clipboard: {result.stderr}"
            return f"Clipboard contents:\n{result.stdout}" if result.stdout.strip() else "Clipboard is empty."

        elif name == "clipboard_write":
            text = input_data["text"]
            # Use PowerShell to write clipboard
            result = subprocess.run(
                ['powershell', '-command', f'Set-Clipboard -Value "{text}"'],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0:
                return f"Error writing to clipboard: {result.stderr}"
            return f"Copied {len(text)} characters to clipboard."

        elif name == "process_list":
            name_filter = input_data.get("filter", "").lower()
            max_results = input_data.get("max_results", 50)
            procs = []
            for proc in psutil.process_iter(['pid', 'name', 'memory_info', 'cpu_percent']):
                try:
                    pinfo = proc.info
                    pname = pinfo['name']
                    if name_filter and name_filter not in pname.lower():
                        continue
                    mem = pinfo['memory_info']
                    mem_str = _fmt_size(mem.rss) if mem else "N/A"
                    procs.append(f"  PID {pinfo['pid']:>7}  {pname:<30} MEM: {mem_str}")
                    if len(procs) >= max_results:
                        break
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            if not procs:
                return "No matching processes found."
            header = f"Running processes{' (filter: ' + name_filter + ')' if name_filter else ''}:\n"
            return header + "\n".join(procs)

        elif name == "kill_process":
            pid = input_data.get("pid")
            pname = input_data.get("name")
            if not pid and not pname:
                return "Error: Provide either pid or name."

            if pid:
                try:
                    proc = psutil.Process(pid)
                    proc_name = proc.name()
                    proc.terminate()
                    return f"Killed process: {proc_name} (PID {pid})"
                except psutil.NoSuchProcess:
                    return f"Error: No process with PID {pid}"
                except psutil.AccessDenied:
                    return f"Error: Access denied for PID {pid}. May need admin privileges."
            else:
                for proc in psutil.process_iter(['pid', 'name']):
                    try:
                        if proc.info['name'].lower() == pname.lower():
                            proc.terminate()
                            return f"Killed process: {proc.info['name']} (PID {proc.info['pid']})"
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
                return f"Error: No process found with name '{pname}'"

        # ── ASK USER ──
        elif name == "ask_user":
            question = input_data["question"]
            options = [input_data.get("option1", ""), input_data.get("option2", ""), input_data.get("option3", "")]
            options = [o for o in options if o]

            # Clear previous answer and event
            _ask_event.clear()
            _ask_answer["value"] = None

            # Push UI to frontend
            if _ask_ui_callback:
                _ask_ui_callback(question, options)
            else:
                return f"Error: No UI callback set for ask_user."

            # Block until user responds (timeout 5 minutes)
            answered = _ask_event.wait(timeout=300)
            if not answered:
                return "User did not respond within 5 minutes."

            return f"User answered: {_ask_answer['value']}"

        # ── SCREENSHOT ──
        elif name == "screenshot":
            try:
                from PIL import ImageGrab
            except ImportError:
                return "Error: Pillow not installed. Run: pip install Pillow"

            mode = input_data.get("mode", "full")
            save_dir = resolve_path(input_data.get("save_path", "screenshots"))
            os.makedirs(save_dir, exist_ok=True) if not os.path.isfile(save_dir) else None
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

            if mode == "region":
                x = input_data.get("x", 0)
                y = input_data.get("y", 0)
                w = input_data.get("width", 400)
                h = input_data.get("height", 300)
                img = ImageGrab.grab(bbox=(x, y, x + w, y + h))
            else:
                img = ImageGrab.grab()

            if os.path.isfile(save_dir):
                fpath = save_dir
            else:
                fpath = os.path.join(save_dir, f"screenshot_{ts}.png")
            img.save(fpath, "PNG")

            # Generate base64 preview (resized to max 800px wide for token efficiency)
            from PIL import Image
            import io
            preview = img.copy()
            if preview.width > 800:
                ratio = 800 / preview.width
                preview = preview.resize((800, int(preview.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            preview.save(buf, format="PNG", optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode('ascii')

            return f"Screenshot saved: {fpath}\nResolution: {img.width}x{img.height}\nBase64 preview ({len(b64)} chars): [IMAGE_CAPTURED]"

        # ── SCREEN RECORDING ──
        elif name == "record_screen":
            action = input_data["action"]

            if action == "start":
                if _recording["active"]:
                    return "Error: Already recording. Use action='stop' first."

                fmt = input_data.get("format", "mp4")
                save_dir = resolve_path(input_data.get("save_path", "recordings"))
                os.makedirs(save_dir, exist_ok=True)
                ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                ext = "gif" if fmt == "gif" else "mp4"
                fpath = os.path.join(save_dir, f"recording_{ts}.{ext}")
                duration = input_data.get("duration")

                # Use ffmpeg with gdigrab (Windows)
                cmd = ["ffmpeg", "-y", "-f", "gdigrab", "-framerate", "15", "-i", "desktop"]
                if duration:
                    cmd += ["-t", str(duration)]
                if fmt == "gif":
                    cmd += ["-vf", "fps=10,scale=800:-1:flags=lanczos", fpath]
                else:
                    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", fpath]

                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                _recording["active"] = True
                _recording["process"] = proc
                _recording["path"] = fpath
                _recording["start_time"] = time.time()

                if duration:
                    # Auto-stop thread
                    def auto_stop():
                        proc.wait()
                        _recording["active"] = False
                    threading.Thread(target=auto_stop, daemon=True).start()
                    return f"Recording started ({duration}s, {fmt}). Will save to: {fpath}"
                else:
                    return f"Recording started ({fmt}). Use record_screen action='stop' to end. Saving to: {fpath}"

            elif action == "stop":
                if not _recording["active"] or not _recording["process"]:
                    return "Error: No active recording."

                proc = _recording["process"]
                try:
                    proc.terminate()
                    proc.wait(timeout=10)
                except Exception:
                    proc.kill()

                elapsed = time.time() - _recording["start_time"]
                fpath = _recording["path"]
                _recording["active"] = False
                _recording["process"] = None

                if os.path.exists(fpath):
                    sz = _fmt_size(os.path.getsize(fpath))
                    return f"Recording stopped. Duration: {elapsed:.1f}s\nSaved: {fpath} ({sz})"
                return f"Recording stopped after {elapsed:.1f}s but file may not have been created. Path: {fpath}"

            else:
                return "Error: action must be 'start' or 'stop'"

        # ── DISCORD ──
        elif name == "discord_login":
            token = input_data["token"]
            headers = {"Authorization": f"{token}", "Content-Type": "application/json"}
            try:
                r = req.get("https://discord.com/api/v10/users/@me", headers=headers, timeout=10)
                if r.status_code == 200:
                    data = r.json()
                    _discord["token"] = token
                    _discord["username"] = data.get("username", "Unknown")
                    _discord["discriminator"] = data.get("discriminator", "0")
                    _discord["user_id"] = data.get("id")
                    return f"Logged in as: {_discord['username']}#{_discord['discriminator']} (ID: {_discord['user_id']})"
                elif r.status_code == 401:
                    return "Error: Invalid Discord token. Please check and try again."
                else:
                    return f"Error: Discord API returned status {r.status_code}: {r.text[:200]}"
            except req.RequestException as e:
                return f"Error connecting to Discord: {e}"

        elif name == "discord_status":
            if _discord["token"]:
                return f"Logged in as: {_discord['username']}#{_discord['discriminator']} (ID: {_discord['user_id']})"
            else:
                return "Not logged in. Use discord_login with a Discord token to connect. Ask the user for their token."

        elif name == "discord_friends":
            if not _discord["token"]:
                return "Error: Not logged in. Use discord_login first. Ask the user for their Discord token."
            headers = {"Authorization": f"{_discord['token']}", "Content-Type": "application/json"}
            # Bots can't access friends list directly, list guilds + members instead
            try:
                r = req.get("https://discord.com/api/v10/users/@me/guilds", headers=headers, timeout=10)
                if r.status_code != 200:
                    return f"Error: {r.status_code} - {r.text[:200]}"
                guilds = r.json()
                lines = [f"Connected to {len(guilds)} server(s):"]
                for g in guilds[:20]:
                    lines.append(f"  {g['name']} (ID: {g['id']})")
                return "\n".join(lines)
            except req.RequestException as e:
                return f"Error: {e}"

        elif name == "discord_dms":
            if not _discord["token"]:
                return "Error: Not logged in. Use discord_login first."
            headers = {"Authorization": f"{_discord['token']}", "Content-Type": "application/json"}
            name_filter = input_data.get("filter", "").lower()
            try:
                r = req.get("https://discord.com/api/v10/users/@me/channels", headers=headers, timeout=10)
                if r.status_code != 200:
                    return f"Error: {r.status_code} - {r.text[:200]}"
                dms = r.json()
                lines = []
                for dm in dms:
                    if dm.get("type") == 1:  # Direct DM
                        for recip in dm.get("recipients", []):
                            uname = recip.get("username", "???")
                            display = recip.get("global_name", "")
                            uid = recip.get("id", "???")
                            label = f"{display} (@{uname})" if display else f"@{uname}"
                            if name_filter and name_filter not in uname.lower() and name_filter not in (display or "").lower():
                                continue
                            lines.append(f"  {label:>30}  ID: {uid}")
                    elif dm.get("type") == 3:  # Group DM
                        names = ", ".join(r.get("username", "?") for r in dm.get("recipients", []))
                        if name_filter and name_filter not in names.lower():
                            continue
                        lines.append(f"  [GROUP] {names}")
                if not lines:
                    return f"No DMs found{' matching ' + chr(34) + name_filter + chr(34) if name_filter else ''}."
                return f"DM conversations ({len(lines)}):\n" + "\n".join(lines)
            except req.RequestException as e:
                return f"Error: {e}"

        elif name == "discord_send":
            if not _discord["token"]:
                return "Error: Not logged in. Use discord_login first."
            headers = {"Authorization": f"{_discord['token']}", "Content-Type": "application/json"}

            user_id = input_data.get("user_id")
            username = input_data.get("username")
            message = input_data.get("message", "")
            file_path = input_data.get("file_path")

            # If username provided, search DM channels for the user
            if not user_id and username:
                try:
                    r_dms = req.get("https://discord.com/api/v10/users/@me/channels", headers=headers, timeout=10)
                    if r_dms.status_code == 200:
                        for dm in r_dms.json():
                            if dm.get("type") in (1, 3):  # DM or group DM
                                for recipient in dm.get("recipients", []):
                                    rname = recipient.get("username", "").lower()
                                    display = recipient.get("global_name", "").lower()
                                    if username.lower() in rname or username.lower() in display:
                                        user_id = recipient["id"]
                                        break
                            if user_id:
                                break
                    if not user_id:
                        return f"Error: No DM found with user matching '{username}'. Try providing their Discord user ID instead."
                except req.RequestException as e:
                    return f"Error searching DMs: {e}"

            if not user_id:
                return "Error: Provide user_id or username."

            try:
                # Create DM channel
                r = req.post("https://discord.com/api/v10/users/@me/channels",
                            headers=headers, json={"recipient_id": user_id}, timeout=10)
                if r.status_code not in (200, 201):
                    return f"Error creating DM: {r.status_code} - {r.text[:200]}"
                channel_id = r.json()["id"]

                # Send message and/or file
                if file_path:
                    fpath = resolve_path(file_path)
                    if not os.path.exists(fpath):
                        return f"Error: File not found: {fpath}"
                    with open(fpath, 'rb') as f:
                        files = {"file": (os.path.basename(fpath), f)}
                        data = {"content": message} if message else {}
                        # Remove Content-Type for multipart
                        h2 = {"Authorization": f"{_discord['token']}"}
                        r2 = req.post(f"https://discord.com/api/v10/channels/{channel_id}/messages",
                                     headers=h2, data=data, files=files, timeout=30)
                else:
                    if not message:
                        return "Error: Provide a message or file_path."
                    r2 = req.post(f"https://discord.com/api/v10/channels/{channel_id}/messages",
                                 headers=headers, json={"content": message}, timeout=10)

                if r2.status_code in (200, 201):
                    return f"Message sent to user {user_id}" + (f" with file {os.path.basename(file_path)}" if file_path else "")
                else:
                    return f"Error sending: {r2.status_code} - {r2.text[:200]}"
            except req.RequestException as e:
                return f"Error: {e}"

        elif name == "discord_channels":
            if not _discord["token"]:
                return "Error: Not logged in. Use discord_login first."
            headers = {"Authorization": f"{_discord['token']}", "Content-Type": "application/json"}

            server_id = input_data.get("server_id")
            server_name = input_data.get("server_name")

            if not server_id and server_name:
                # Search guilds by name
                try:
                    r = req.get("https://discord.com/api/v10/users/@me/guilds", headers=headers, timeout=10)
                    if r.status_code != 200:
                        return f"Error: {r.status_code}"
                    for g in r.json():
                        if server_name.lower() in g["name"].lower():
                            server_id = g["id"]
                            break
                    if not server_id:
                        return f"Error: No server found matching '{server_name}'"
                except req.RequestException as e:
                    return f"Error: {e}"

            if not server_id:
                return "Error: Provide server_id or server_name."

            try:
                r = req.get(f"https://discord.com/api/v10/guilds/{server_id}/channels", headers=headers, timeout=10)
                if r.status_code != 200:
                    return f"Error: {r.status_code} - {r.text[:200]}"
                channels = r.json()
                lines = []
                type_names = {0: "text", 2: "voice", 4: "category", 5: "announcement", 13: "stage", 15: "forum"}
                for ch in sorted(channels, key=lambda c: c.get("position", 0)):
                    t = type_names.get(ch["type"], "other")
                    lines.append(f"  [{t:>12}] #{ch['name']} (ID: {ch['id']})")
                return f"Channels in server {server_id}:\n" + "\n".join(lines)
            except req.RequestException as e:
                return f"Error: {e}"

        else:
            return f"Error: Unknown tool: {name}"

    except subprocess.TimeoutExpired:
        return "Error: Command timed out after 120 seconds"
    except Exception as e:
        return f"Error: {type(e).__name__}: {str(e)}"
