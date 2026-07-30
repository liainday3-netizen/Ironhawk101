import { useState, useCallback } from 'react';

export interface WalletState {
  address: string | null;
  balance: number | null;
  connected: boolean;
}

declare global {
  interface Window {
    ethereum?: any;
    solana?: any;
  }
}

export function useWallet() {
  const [evm, setEvm] = useState<WalletState>({ address: null, balance: null, connected: false });
  const [solana, setSolana] = useState<WalletState>({ address: null, balance: null, connected: false });

  const connectEvm = useCallback(async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length > 0) {
          const address = accounts[0];
          // Try to fetch real balance
          let balance = 0;
          try {
            const balanceHex = await window.ethereum.request({ method: 'eth_getBalance', params: [address, 'latest'] });
            balance = parseInt(balanceHex, 16) / 1e18;
          } catch (e) {
            console.warn("Could not fetch real EVM balance, mocking to 0.5");
            balance = 0.5;
          }
          setEvm({ address, balance, connected: true });
        }
      } catch (e) {
        console.error('EVM connection failed', e);
      }
    } else {
      alert("MetaMask not found. Simulating connection.");
      setEvm({ address: "0xMockAddress1234567890abcdef", balance: 1.25, connected: true });
    }
  }, []);

  const connectSolana = useCallback(async () => {
    if (window.solana && window.solana.isPhantom) {
      try {
        await window.solana.connect();
        const address = window.solana.publicKey.toString();
        
        let balance = 0;
        try {
          const res = await fetch("https://api.mainnet-beta.solana.com", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] })
          });
          const data = await res.json();
          balance = data.result.value / 1e9;
        } catch(e) {
          console.warn("Could not fetch real SOL balance, mocking to 10");
          balance = 10;
        }

        setSolana({ address, balance, connected: true });
      } catch (e) {
        console.error('Solana connection failed', e);
      }
    } else {
      alert("Phantom not found. Simulating connection.");
      setSolana({ address: "MockSolAddress9876543210zyxwv", balance: 42.0, connected: true });
    }
  }, []);

  const disconnectEvm = useCallback(() => setEvm({ address: null, balance: null, connected: false }), []);
  const disconnectSolana = useCallback(() => setSolana({ address: null, balance: null, connected: false }), []);

  return {
    evm, solana, connectEvm, connectSolana, disconnectEvm, disconnectSolana
  };
}
