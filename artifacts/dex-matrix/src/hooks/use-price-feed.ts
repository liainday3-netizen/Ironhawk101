import { useState, useEffect } from 'react';

export function usePriceFeed() {
  const [prices, setPrices] = useState({ sol: 0, eth: 0, btc: 0, usdc: 1 });

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('https://coins.llama.fi/prices/current/coingecko:solana,coingecko:ethereum,coingecko:bitcoin,coingecko:usd-coin');
        const data = await res.json();
        const coins = data.coins;
        setPrices({
          sol: coins['coingecko:solana']?.price || 0,
          eth: coins['coingecko:ethereum']?.price || 0,
          btc: coins['coingecko:bitcoin']?.price || 0,
          usdc: coins['coingecko:usd-coin']?.price || 1,
        });
      } catch (e) {
        console.error('Failed to fetch prices', e);
        // Fallback mock prices if API fails
        setPrices(prev => prev.eth === 0 ? { sol: 150, eth: 3000, btc: 65000, usdc: 1 } : prev);
      }
    };
    
    fetchPrices();
    const interval = setInterval(fetchPrices, 15000);
    return () => clearInterval(interval);
  }, []);

  return prices;
}
