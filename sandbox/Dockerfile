# quist-sandbox — the per-project container image used when SANDBOX_DRIVER=docker
# (a VPS or any host with a Docker socket). One container per project, started
# with --network=none, --read-only, and CPU/memory/pids caps by server/sandbox.js.
#
# This is the "kitchen sink": most toolchains from the brief that work on Linux.
# Build once:  docker build -t quist-sandbox ./sandbox
FROM debian:bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential clang lld llvm clang-tools cmake ninja-build make autoconf pkg-config gdb \
      git curl wget ca-certificates xz-utils unzip zip procps file \
      bash coreutils findutils grep sed gawk ripgrep \
      mingw-w64 \
      python3 python3-pip python3-venv \
      default-jdk maven gradle kotlin \
      golang \
      ruby ruby-dev \
      php-cli \
      lua5.4 luajit \
      r-base \
      gfortran gnat gnucobol \
      ghc cabal-install \
      ocaml opam \
      nim \
      fpc \
      erlang elixir \
      nodejs npm \
      emscripten \
    && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
    && mv /root/.cargo /opt/cargo && mv /root/.rustup /opt/rustup
ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup PATH="/opt/cargo/bin:${PATH}"

# Zig
RUN ARCH=$(uname -m) && ZIG=0.13.0 \
    && curl -sSL "https://ziglang.org/download/${ZIG}/zig-linux-${ARCH}-${ZIG}.tar.xz" -o /tmp/zig.tar.xz \
    && mkdir -p /opt/zig && tar -xJf /tmp/zig.tar.xz -C /opt/zig --strip-components=1 \
    && ln -s /opt/zig/zig /usr/local/bin/zig && rm /tmp/zig.tar.xz

# .NET SDK (C#, F#, VB.NET)
RUN curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dn.sh && bash /tmp/dn.sh --channel 8.0 --install-dir /opt/dotnet && rm /tmp/dn.sh
ENV DOTNET_ROOT=/opt/dotnet PATH="/opt/dotnet:${PATH}"
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1

# Wine for running Windows .exe artifacts (LGPL; no licensing cost).
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends wine wine64 wine32 xvfb \
    && rm -rf /var/lib/apt/lists/* || true

RUN useradd -m -u 10001 unit
WORKDIR /workspace
USER unit
CMD ["sleep", "infinity"]
