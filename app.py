"""Claude Code Clone - Main Application (pywebview)"""

import json
import os
import webview
import anthropic
from api_handler import (
    API_KEY, CUSTOM_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT,
    set_stop, clear_stop, is_stopped, next_generation_id, get_generation_id
)
from tools import TOOL_DEFINITIONS, execute_tool, set_ask_callback, submit_user_answer


class Api:
    """Exposed to JavaScript via window.pywebview.api"""

    def __init__(self, window_ref):
        self._window = window_ref
        self._current_gen_id = 0  # tracks which generation is active

    def send_message(self, history_json: str, model: str, system_prompt: str) -> str:
        """
        Called from JS. Runs the full API loop with tool calls.
        pywebview runs exposed methods in a background thread automatically.
        """
        # Assign a new generation ID — any older generation will see the mismatch and bail
        gen_id = next_generation_id()
        self._current_gen_id = gen_id
        clear_stop()

        try:
            messages = json.loads(history_json)
            result = self._run_loop(messages, model, system_prompt, gen_id)
            return json.dumps(result)
        except Exception as e:
            return json.dumps({"steps": [], "final_text": "", "messages": [],
                               "error": f"{type(e).__name__}: {str(e)}"})

    def stop_generation(self):
        """Called from JS stop button. Signals the loop to abort."""
        set_stop()
        # Also bump generation ID so the old loop's callbacks become no-ops
        next_generation_id()

    def open_file_dialog(self):
        if self._window is None:
            return None
        result = self._window.create_file_dialog(webview.OPEN_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None

    def submit_answer(self, answer: str):
        """Called from JS when user picks an option or types custom answer."""
        submit_user_answer(answer)

    # ── Chat persistence (file-based) ──

    def _chats_dir(self):
        d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chats')
        os.makedirs(d, exist_ok=True)
        return d

    def save_conversations(self, conversations_json: str):
        """Save conversation list (metadata) to chats/conversations.json"""
        path = os.path.join(self._chats_dir(), 'conversations.json')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(conversations_json)

    def load_conversations(self) -> str:
        """Load conversation list from chats/conversations.json"""
        path = os.path.join(self._chats_dir(), 'conversations.json')
        if not os.path.exists(path):
            return '[]'
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()

    def save_chat_messages(self, chat_id: str, messages_json: str):
        """Save a single chat's messages to chats/{chat_id}.json"""
        # Sanitize chat_id
        safe_id = "".join(c for c in chat_id if c.isalnum() or c in ('_', '-'))
        path = os.path.join(self._chats_dir(), f'{safe_id}.json')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(messages_json)

    def load_chat_messages(self, chat_id: str) -> str:
        """Load a single chat's messages from chats/{chat_id}.json"""
        safe_id = "".join(c for c in chat_id if c.isalnum() or c in ('_', '-'))
        path = os.path.join(self._chats_dir(), f'{safe_id}.json')
        if not os.path.exists(path):
            return '[]'
        with open(path, 'r', encoding='utf-8') as f:
            return f.read()

    def delete_chat_file(self, chat_id: str):
        """Delete a chat's message file"""
        safe_id = "".join(c for c in chat_id if c.isalnum() or c in ('_', '-'))
        path = os.path.join(self._chats_dir(), f'{safe_id}.json')
        if os.path.exists(path):
            os.remove(path)

    # ── Trim large tool results to save tokens ──
    @staticmethod
    def _trim_result(result, max_chars=12000):
        if len(result) <= max_chars:
            return result
        half = max_chars // 2
        return result[:half] + "\n...[TRUNCATED — middle removed to save tokens]...\n" + result[-half:]

    # ── Internal: the actual API loop ──

    def _push_js(self, gen_id, js_code):
        """Run JS on the frontend, but only if this generation is still current."""
        if gen_id != get_generation_id():
            return  # stale generation, discard
        if self._window is None:
            return
        try:
            self._window.evaluate_js(js_code)
        except Exception:
            pass

    def _run_loop(self, messages, model, system_prompt, gen_id):
        # Register ask_user callback so tools.py can push questions to the UI
        def _ask_ui(question, options):
            q_js = json.dumps(question)
            opts_js = json.dumps(options)
            self._push_js(gen_id, f'showAskUser({q_js}, {opts_js})')

        set_ask_callback(_ask_ui)

        client = anthropic.Anthropic(api_key=API_KEY)

        system_text = system_prompt.strip() if system_prompt.strip() else (
            CUSTOM_SYSTEM_PROMPT.strip() if CUSTOM_SYSTEM_PROMPT.strip() else DEFAULT_SYSTEM_PROMPT
        )

        # ── CACHED system prompt ──
        system = [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]

        # ── CACHED tools — mark last tool so entire array is cached ──
        tools = []
        for i, t in enumerate(TOOL_DEFINITIONS):
            td = {"name": t["name"], "description": t["description"], "input_schema": t["input_schema"]}
            if i == len(TOOL_DEFINITIONS) - 1:
                td["cache_control"] = {"type": "ephemeral"}
            tools.append(td)

        steps = []
        final_text = ""
        max_iterations = 50
        iteration = 0

        try:
            while iteration < max_iterations:
                # ── Check stop (works across threads via threading.Event) ──
                if is_stopped() or gen_id != get_generation_id():
                    steps.append({"type": "text", "content": "\n\n*[Generation stopped by user]*"})
                    break

                iteration += 1

                # ── CACHE conversation history ──
                # Strip ALL old cache_control from messages first (max 4 total allowed)
                for msg in messages:
                    c = msg.get("content")
                    if isinstance(c, list):
                        for block in c:
                            if isinstance(block, dict):
                                block.pop("cache_control", None)

                # Mark second-to-last message for caching
                if len(messages) >= 2:
                    target = messages[-2]
                    if isinstance(target.get("content"), str):
                        target["content"] = [{"type": "text", "text": target["content"], "cache_control": {"type": "ephemeral"}}]
                    elif isinstance(target.get("content"), list) and len(target["content"]) > 0:
                        target["content"][-1] = dict(target["content"][-1])
                        target["content"][-1]["cache_control"] = {"type": "ephemeral"}

                response = client.messages.create(
                    model=model,
                    max_tokens=16000,
                    system=system,
                    tools=tools,
                    messages=messages
                )

                # ── Log cache stats ──
                u = response.usage
                cw = getattr(u, 'cache_creation_input_tokens', 0) or 0
                cr = getattr(u, 'cache_read_input_tokens', 0) or 0
                print(f"[cache] in={u.input_tokens} cached_write={cw} cached_read={cr} out={u.output_tokens}")

                # ── Check stop again after the (potentially slow) API call ──
                if is_stopped() or gen_id != get_generation_id():
                    steps.append({"type": "text", "content": "\n\n*[Generation stopped by user]*"})
                    break

                assistant_content = []
                tool_uses = []

                for block in response.content:
                    if block.type == "text":
                        assistant_content.append({"type": "text", "text": block.text})
                        step = {"type": "text", "content": block.text}
                        steps.append(step)
                        final_text = block.text
                        # Push text to UI in real-time
                        text_js = json.dumps(block.text)
                        self._push_js(gen_id, f'updateFinalText({text_js})')
                    elif block.type == "tool_use":
                        assistant_content.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input
                        })
                        tool_uses.append(block)

                messages.append({"role": "assistant", "content": assistant_content})

                # ── Handle max_tokens: don't crash, just stop gracefully ──
                if response.stop_reason == "max_tokens":
                    truncation_msg = "\n\n*[Response truncated — token limit reached]*"
                    steps.append({"type": "text", "content": truncation_msg})
                    final_text += truncation_msg
                    self._push_js(gen_id, f'updateFinalText({json.dumps(truncation_msg)})')
                    break

                # Normal end
                if response.stop_reason == "end_turn" or not tool_uses:
                    break

                # ── Execute tool calls ──
                tool_results = []
                for tool in tool_uses:
                    if is_stopped() or gen_id != get_generation_id():
                        break

                    result = execute_tool(tool.name, tool.input)

                    # Trim large results to save tokens on future calls
                    trimmed = self._trim_result(result)

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool.id,
                        "content": trimmed
                    })

                    step = {
                        "type": "tool_use",
                        "name": tool.name,
                        "input": tool.input,
                        "result": result
                    }
                    steps.append(step)

                    # Push tool call to UI in real-time
                    name_js = json.dumps(tool.name)
                    inp_js = json.dumps(json.dumps(tool.input, indent=2))
                    # Truncate very long results for the UI push
                    res_display = result[:3000] if len(result) > 3000 else result
                    res_js = json.dumps(res_display)
                    self._push_js(gen_id, f'updateToolProgress({name_js}, {inp_js}, {res_js}, "done")')

                if is_stopped() or gen_id != get_generation_id():
                    steps.append({"type": "text", "content": "\n\n*[Generation stopped by user]*"})
                    break

                messages.append({"role": "user", "content": tool_results})

                # Show thinking indicator for next iteration
                self._push_js(gen_id, 'showThinking()')

            return {
                "steps": steps,
                "final_text": final_text,
                "messages": messages,
                "error": None
            }

        except anthropic.AuthenticationError:
            return {"steps": [], "final_text": "", "messages": messages,
                    "error": "Invalid API key. Set your API key in api_handler.py (API_KEY variable)."}
        except anthropic.RateLimitError:
            return {"steps": [], "final_text": "", "messages": messages,
                    "error": "Rate limited. Please wait a moment and try again."}
        except Exception as e:
            return {"steps": [], "final_text": "", "messages": messages,
                    "error": f"{type(e).__name__}: {str(e)}"}


def main():
    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html')

    api = Api(None)

    window = webview.create_window(
        'Claude Code',
        url=html_path,
        width=1200,
        height=800,
        min_size=(800, 500),
        js_api=api,
        text_select=True
    )

    # Set window reference so API can push JS updates
    api._window = window

    webview.start(debug=False)


if __name__ == '__main__':
    main()
