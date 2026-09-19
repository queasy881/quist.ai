# Quist.ai app image for Railway.
#
# This single image runs the web server AND is the default place shells and
# builds run (SANDBOX_DRIVER=local). So it carries a working set of toolchains:
# clang/gcc, Python, Go, Rust, Zig, a JDK, Node, plus MinGW-w64 for Windows
# cross-compiles. Add more languages here as needed (see sandbox/Dockerfile for
# the full "kitchen sink" image used by the docker driver on a VPS).
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang lld llvm cmake ninja-build make pkg-config \
      git curl ca-certificates xz-utils unzip \
      python3 python3-pip \
      golang \
      default-jdk \
      mingw-w64 \
    && rm -rf /var/lib/apt/lists/*

# Rust (stable) — small, gives cargo for the `rust` toolchain.
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# Zig — great C/C++ cross-compiler and its own language.
RUN ARCH=$(uname -m) && ZIG=0.13.0 \
    && curl -sSL "https://ziglang.org/download/${ZIG}/zig-linux-${ARCH}-${ZIG}.tar.xz" -o /tmp/zig.tar.xz \
    && mkdir -p /opt/zig && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && ln -s /opt/zig/zig /usr/local/bin/zig && rm /tmp/zig.tar.xz

WORKDIR /app
COPY package*.json ./
# node-pty compiles against the base image's toolchain (present above).
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV SANDBOX_DRIVER=local
ENV WORKSPACE_ROOT=/data/workspaces
EXPOSE 3000

# Run as an unprivileged user; /data is the writable workspace root.
RUN useradd -m -u 10001 unit && mkdir -p /data/workspaces && chown -R unit:unit /data /app
USER unit

CMD ["node", "server/index.js"]
