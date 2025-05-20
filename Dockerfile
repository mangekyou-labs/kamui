FROM ubuntu:20.04

RUN apt-get update && \
    apt-get install -y curl build-essential pkg-config libssl-dev libudev-dev \
    git python3 sudo nodejs npm

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Solana 1.18.1
RUN sh -c "$(curl -sSfL https://releases.solana.com/v1.18.1/install)" && \
    /root/.local/share/solana/install/active_release/bin/solana --version

# Install Anchor 0.29.0
RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked && \
    avm install 0.29.0 && \
    avm use 0.29.0

WORKDIR /app

# Copy the project
COPY . .

# Run the test
CMD cd kamui-program && npm install && anchor test 