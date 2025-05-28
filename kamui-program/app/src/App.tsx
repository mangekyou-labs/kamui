import { useState } from 'react';
import type { FC } from 'react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import VRFDemo from './components/VRFDemo';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

const App: FC = () => {
  // Can be set to 'devnet', 'testnet', or 'mainnet-beta'
  const network = WalletAdapterNetwork.Devnet;

  // You can also provide a custom RPC endpoint
  const endpoint = clusterApiUrl(network);

  // @solana/wallet-adapter-wallets includes all the adapters but supports tree shaking and lazy loading
  const wallets = [new PhantomWalletAdapter()];

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 text-white p-4">
            <div className="container mx-auto px-4 py-8">
              <header className="flex justify-between items-center mb-12">
                <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                  Kamui VRF Demo
                </h1>
                <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700" />
              </header>
              <main>
                <VRFDemo />
              </main>
              <footer className="mt-12 text-center text-gray-400">
                <p>Running on Solana {network}</p>
              </footer>
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;
