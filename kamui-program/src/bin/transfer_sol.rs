use {
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signature::{Keypair, read_keypair_file, Signer},
        transaction::Transaction,
        system_instruction,
    },
    solana_client::rpc_client::RpcClient,
    clap::Parser,
    std::{
        str::FromStr,
        error::Error,
    },
};

#[derive(Parser, Debug)]
struct Args {
    /// Amount of SOL to transfer
    #[clap(short, long)]
    amount: f64,

    /// Recipient address
    #[clap(short, long)]
    to: String,

    /// Path to keypair file
    #[clap(short, long, default_value = "../vrf-test/keypair.json")]
    keypair: String,

    /// RPC URL
    #[clap(short, long, default_value = "https://api.devnet.solana.com")]
    url: String,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();
    
    // Convert amount to lamports
    let lamports = (args.amount * 1_000_000_000.0) as u64;
    
    // Load keypair
    let keypair = read_keypair_file(&args.keypair)?;
    
    // Create RPC client
    let rpc_client = RpcClient::new_with_commitment(
        args.url.clone(),
        CommitmentConfig::confirmed(),
    );
    
    // Parse recipient address
    let to = solana_sdk::pubkey::Pubkey::from_str(&args.to)?;
    
    // Check balance
    let balance = rpc_client.get_balance(&keypair.pubkey())?;
    println!("Current balance: {} SOL", balance as f64 / 1_000_000_000.0);
    
    if balance < lamports {
        return Err(format!("Insufficient balance: {} SOL", balance as f64 / 1_000_000_000.0).into());
    }
    
    // Create transfer instruction
    let instruction = system_instruction::transfer(
        &keypair.pubkey(),
        &to,
        lamports,
    );
    
    // Create and send transaction
    let recent_blockhash = rpc_client.get_latest_blockhash()?;
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&keypair.pubkey()),
        &[&keypair],
        recent_blockhash,
    );
    
    let signature = rpc_client.send_and_confirm_transaction(&transaction)?;
    println!("Transfer successful! Signature: {}", signature);
    
    // Check new balance
    let new_balance = rpc_client.get_balance(&keypair.pubkey())?;
    println!("New balance: {} SOL", new_balance as f64 / 1_000_000_000.0);
    
    Ok(())
} 