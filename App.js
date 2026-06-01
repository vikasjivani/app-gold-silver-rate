import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  AppState,
  Platform,
  Animated,
  Dimensions,
  Modal,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

// Try to import AdMob — will fail in Expo Go (no native modules)
let BannerAd, BannerAdSize, InterstitialAd, AdEventType;
let isAdMobAvailable = false;
try {
  const admob = require('react-native-google-mobile-ads');
  BannerAd = admob.BannerAd;
  BannerAdSize = admob.BannerAdSize;
  InterstitialAd = admob.InterstitialAd;
  AdEventType = admob.AdEventType;
  isAdMobAvailable = true;
} catch (e) {
  console.log('AdMob not available (Expo Go). Showing placeholder ad.');
}

const API_BASE = 'https://api.gold-api.com/price';
const EXCHANGE_RATE_API = 'https://open.er-api.com/v6/latest/USD';
const POLL_INTERVAL = 5000; // 5 seconds
const EXCHANGE_RATE_POLL_INTERVAL = 30 * 60 * 1000; // 30 minutes
const TROY_OZ_TO_GRAMS = 31.1035; // 1 troy ounce = 31.1035 grams (NOT 28.35 which is a regular ounce)
const LBS_TO_KG = 0.453592; // 1 pound = 0.453592 kg (Copper is priced per lb)

// India Import Duty for precious metals (effective May 2026)
// BCD (Basic Customs Duty): 10%
// AIDC (Agriculture Infrastructure & Development Cess): 5%
// GST (Goods & Services Tax): 3% (applied on value + customs)
// Effective total: (1 + 0.10 + 0.05) × (1 + 0.03) = 1.15 × 1.03 ≈ 1.1845
const INDIA_DUTY_MULTIPLIER = 1.1845; // ~18.45% effective duty+tax

// Real AdMob unit IDs
const BANNER_AD_UNIT_ID = 'ca-app-pub-3789345794133466/9199212756';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3789345794133466/6892613614';

// All supported commodities from gold-api.com (FREE, no rate limits!)
const COMMODITIES = [
  {
    symbol: 'XAU',
    name: 'Gold',
    icon: '🥇',
    category: 'precious',
    accentColor: '#FFD700',
    cardBg: '#1C1A0F',
    borderColor: '#3D3508',
    unit: 'oz',
    unitLabel: 'Troy Ounce',
    secondaryUnit: { grams: 10, label: 'Per 10 Grams' },
  },
  {
    symbol: 'XAG',
    name: 'Silver',
    icon: '🥈',
    category: 'precious',
    accentColor: '#C0C0C0',
    cardBg: '#141618',
    borderColor: '#2A2D31',
    unit: 'oz',
    unitLabel: 'Troy Ounce',
    secondaryUnit: { grams: 1000, label: 'Per 1 Kilogram' },
  },
  {
    symbol: 'XPT',
    name: 'Platinum',
    icon: '💎',
    category: 'precious',
    accentColor: '#E5E4E2',
    cardBg: '#17181A',
    borderColor: '#2E3033',
    unit: 'oz',
    unitLabel: 'Troy Ounce',
    secondaryUnit: { grams: 10, label: 'Per 10 Grams' },
  },
  {
    symbol: 'XPD',
    name: 'Palladium',
    icon: '⚡',
    category: 'precious',
    accentColor: '#B8A9C9',
    cardBg: '#16141A',
    borderColor: '#2D2835',
    unit: 'oz',
    unitLabel: 'Troy Ounce',
    secondaryUnit: { grams: 10, label: 'Per 10 Grams' },
  },
  {
    symbol: 'HG',
    name: 'Copper',
    icon: '🔶',
    category: 'industrial',
    accentColor: '#B87333',
    cardBg: '#1A1510',
    borderColor: '#352B1D',
    unit: 'lb',
    unitLabel: 'Per Pound',
    secondaryUnit: { kg: 1, label: 'Per 1 Kilogram' },
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    icon: '₿',
    category: 'crypto',
    accentColor: '#F7931A',
    cardBg: '#1A1608',
    borderColor: '#352F10',
    unit: 'coin',
    unitLabel: 'Per 1 BTC',
    secondaryUnit: null, // no secondary conversion for crypto
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    icon: 'Ξ',
    category: 'crypto',
    accentColor: '#627EEA',
    cardBg: '#111420',
    borderColor: '#1E2540',
    unit: 'coin',
    unitLabel: 'Per 1 ETH',
    secondaryUnit: null,
  },
];

const CATEGORIES = [
  { key: 'all', label: 'All', icon: '📊' },
  { key: 'precious', label: 'Precious Metals', icon: '✨' },
  { key: 'industrial', label: 'Industrial', icon: '🏭' },
  { key: 'crypto', label: 'Crypto', icon: '🪙' },
];

// Country-wise tax data per commodity (import duty + VAT/GST)
const COUNTRY_TAX_DATA = {
  XAU: [
    { flag: '🇮🇳', name: 'India', taxPercent: 18.45, taxLabel: 'BCD 10% + AIDC 5% + GST 3%' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 0, taxLabel: 'Duty-Free (investment gold)' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 0, taxLabel: 'VAT-Exempt (995+ purity)' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 5, taxLabel: '5% VAT' },
    { flag: '🇨🇳', name: 'China', taxPercent: 13, taxLabel: '13% VAT (non-exchange)' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 10, taxLabel: '10% Consumption Tax' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 0, taxLabel: 'VAT-Exempt (investment gold)' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 0, taxLabel: 'VAT-Exempt' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 0, taxLabel: 'GST-Exempt (99.5%+)' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 0, taxLabel: 'GST-Exempt (99.5%+)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 0, taxLabel: 'Duty-Free' },
    { flag: '🇹🇷', name: 'Turkey', taxPercent: 20, taxLabel: '~20% Import Duty + VAT' },
    { flag: '🇿🇦', name: 'South Africa', taxPercent: 15, taxLabel: '15% VAT' },
    { flag: '🇹🇭', name: 'Thailand', taxPercent: 7, taxLabel: '7% VAT' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Duty / No Tax' },
    { flag: '🇰🇷', name: 'South Korea', taxPercent: 10, taxLabel: '10% VAT' },
    { flag: '🇮🇩', name: 'Indonesia', taxPercent: 11, taxLabel: '11% VAT' },
    { flag: '🇷🇺', name: 'Russia', taxPercent: 0, taxLabel: 'VAT-Exempt (since 2022)' },
  ],
  XAG: [
    { flag: '🇮🇳', name: 'India', taxPercent: 18.45, taxLabel: 'BCD 10% + AIDC 5% + GST 3%' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 0, taxLabel: 'Duty-Free (bullion)' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 20, taxLabel: '20% VAT (not exempt)' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 0, taxLabel: '0% (99%+ purity)' },
    { flag: '🇨🇳', name: 'China', taxPercent: 13, taxLabel: '13% VAT' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 10, taxLabel: '10% Consumption Tax' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 19, taxLabel: '19% VAT (not exempt)' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 8.1, taxLabel: '8.1% VAT' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 0, taxLabel: 'GST-Exempt (99.9%+)' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 0, taxLabel: 'GST-Exempt (99.9%+)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 0, taxLabel: 'Duty-Free (bullion)' },
    { flag: '🇹🇷', name: 'Turkey', taxPercent: 20, taxLabel: '~20% VAT' },
    { flag: '🇿🇦', name: 'South Africa', taxPercent: 15, taxLabel: '15% VAT' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Tax' },
    { flag: '🇰🇷', name: 'South Korea', taxPercent: 10, taxLabel: '10% VAT' },
  ],
  XPT: [
    { flag: '🇮🇳', name: 'India', taxPercent: 15.4, taxLabel: 'BCD 12.5% + AIDC + GST 3%' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 0, taxLabel: 'Duty-Free (bullion)' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 20, taxLabel: '20% VAT (not exempt)' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 5, taxLabel: '5% VAT' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 10, taxLabel: '10% Consumption Tax' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 19, taxLabel: '19% VAT (not exempt)' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 8.1, taxLabel: '8.1% VAT' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 0, taxLabel: 'GST-Exempt (99%+)' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 0, taxLabel: 'GST-Exempt (99%+)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 0, taxLabel: 'Duty-Free' },
    { flag: '🇿🇦', name: 'South Africa', taxPercent: 15, taxLabel: '15% VAT' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Tax' },
  ],
  XPD: [
    { flag: '🇮🇳', name: 'India', taxPercent: 15.4, taxLabel: 'BCD 12.5% + AIDC + GST 3%' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 0, taxLabel: 'Duty-Free (bullion)' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 20, taxLabel: '20% VAT (not exempt)' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 5, taxLabel: '5% VAT' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 10, taxLabel: '10% Consumption Tax' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 19, taxLabel: '19% VAT' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 8.1, taxLabel: '8.1% VAT' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 9, taxLabel: '9% GST (not IPM)' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 10, taxLabel: '10% GST (not exempt)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 0, taxLabel: 'Duty-Free' },
    { flag: '🇿🇦', name: 'South Africa', taxPercent: 15, taxLabel: '15% VAT' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Tax' },
  ],
  HG: [
    { flag: '🇮🇳', name: 'India', taxPercent: 23.5, taxLabel: 'BCD 5% + IGST 18%' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 25, taxLabel: 'Section 232 Tariff 25%' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 0, taxLabel: '0% MFN Duty' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 5, taxLabel: '5% Customs Duty' },
    { flag: '🇨🇳', name: 'China', taxPercent: 2, taxLabel: '~2% Import Duty' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 3, taxLabel: '~3% MFN Duty' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 0, taxLabel: '0% EU MFN Duty' },
    { flag: '🇰🇷', name: 'South Korea', taxPercent: 3, taxLabel: '3% Duty' },
    { flag: '🇹🇷', name: 'Turkey', taxPercent: 5, taxLabel: '5% Customs Duty' },
    { flag: '🇿🇦', name: 'South Africa', taxPercent: 0, taxLabel: '0% Duty' },
  ],
  BTC: [
    { flag: '🇮🇳', name: 'India', taxPercent: 30, taxLabel: '30% Tax + 1% TDS' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 20, taxLabel: '0-20% Capital Gains' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 20, taxLabel: '10-20% CGT' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 0, taxLabel: 'No Tax (individuals)' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 20, taxLabel: '20% Flat Tax (2026)' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 0, taxLabel: '0% if held > 1 year' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 0, taxLabel: 'No CGT (individuals)' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 0, taxLabel: 'No CGT' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 22.5, taxLabel: 'CGT (50% discount)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 25, taxLabel: '50% inclusion rate' },
    { flag: '🇰🇷', name: 'South Korea', taxPercent: 20, taxLabel: '20% on gains >₩2.5M' },
    { flag: '🇹🇭', name: 'Thailand', taxPercent: 15, taxLabel: '15% WHT' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Tax' },
    { flag: '🇷🇺', name: 'Russia', taxPercent: 13, taxLabel: '13% Income Tax' },
  ],
  ETH: [
    { flag: '🇮🇳', name: 'India', taxPercent: 30, taxLabel: '30% Tax + 1% TDS' },
    { flag: '🇺🇸', name: 'USA', taxPercent: 20, taxLabel: '0-20% Capital Gains' },
    { flag: '🇬🇧', name: 'UK', taxPercent: 20, taxLabel: '10-20% CGT' },
    { flag: '🇦🇪', name: 'UAE', taxPercent: 0, taxLabel: 'No Tax (individuals)' },
    { flag: '🇯🇵', name: 'Japan', taxPercent: 20, taxLabel: '20% Flat Tax (2026)' },
    { flag: '🇩🇪', name: 'Germany', taxPercent: 0, taxLabel: '0% if held > 1 year' },
    { flag: '🇨🇭', name: 'Switzerland', taxPercent: 0, taxLabel: 'No CGT (individuals)' },
    { flag: '🇸🇬', name: 'Singapore', taxPercent: 0, taxLabel: 'No CGT' },
    { flag: '🇦🇺', name: 'Australia', taxPercent: 22.5, taxLabel: 'CGT (50% discount)' },
    { flag: '🇨🇦', name: 'Canada', taxPercent: 25, taxLabel: '50% inclusion rate' },
    { flag: '🇰🇷', name: 'South Korea', taxPercent: 20, taxLabel: '20% on gains >₩2.5M' },
    { flag: '🇭🇰', name: 'Hong Kong', taxPercent: 0, taxLabel: 'No Tax' },
    { flag: '🇷🇺', name: 'Russia', taxPercent: 13, taxLabel: '13% Income Tax' },
  ],
};

// Create interstitial ad instance (outside component to persist across renders)
const interstitial = isAdMobAvailable
  ? InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID, {
    requestNonPersonalizedAdsOnly: true,
  })
  : null;

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function App() {
  const [prices, setPrices] = useState({});
  const [usdToInr, setUsdToInr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [detailModalSymbol, setDetailModalSymbol] = useState(null);
  const intervalRef = useRef(null);
  const exchangeRateIntervalRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const prevPrices = useRef({});

  // Animated values for each commodity flash
  const flashAnims = useRef(
    COMMODITIES.reduce((acc, c) => {
      acc[c.symbol] = new Animated.Value(0);
      return acc;
    }, {})
  ).current;
  const [flashColors, setFlashColors] = useState(
    COMMODITIES.reduce((acc, c) => {
      acc[c.symbol] = '#3FB950';
      return acc;
    }, {})
  );

  // Interstitial ad state
  const refreshCountRef = useRef(0);
  const isInterstitialLoaded = useRef(false);

  // Fetch exchange rate (live — refreshes every 30 minutes)
  const fetchExchangeRate = useCallback(async () => {
    try {
      const response = await fetch(EXCHANGE_RATE_API);
      const data = await response.json();
      if (data && data.rates && data.rates.INR) {
        setUsdToInr(data.rates.INR);
      }
    } catch (err) {
      console.warn('Failed to fetch exchange rate:', err);
      // Use a fallback rate if API fails
      setUsdToInr(83.5);
    }
  }, []);

  // Trigger flash animation
  const triggerFlash = useCallback((symbol, direction) => {
    setFlashColors(prev => ({
      ...prev,
      [symbol]: direction === 'up' ? '#3FB950' : '#F85149',
    }));
    flashAnims[symbol].setValue(0.35);
    Animated.timing(flashAnims[symbol], {
      toValue: 0,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [flashAnims]);

  // Fetch all commodity prices
  const fetchPrices = useCallback(async () => {
    try {
      const responses = await Promise.all(
        COMMODITIES.map(c => fetch(`${API_BASE}/${c.symbol}`))
      );
      const data = await Promise.all(responses.map(r => r.json()));

      const newPrices = {};
      data.forEach((d, i) => {
        const sym = COMMODITIES[i].symbol;
        if (d && d.price) {
          newPrices[sym] = d;
          // Check for price change → flash
          if (prevPrices.current[sym] && d.price !== prevPrices.current[sym].price) {
            triggerFlash(sym, d.price > prevPrices.current[sym].price ? 'up' : 'down');
          }
        }
      });

      prevPrices.current = newPrices;
      setPrices(newPrices);
      setLastUpdated(new Date());
      setError(null);
      setLoading(false);

      // Show interstitial ad every 24 refreshes (~2 minutes at 5s interval)
      refreshCountRef.current += 1;
      if (refreshCountRef.current % 24 === 0 && isInterstitialLoaded.current && interstitial) {
        interstitial.show();
        isInterstitialLoaded.current = false;
      }
    } catch (err) {
      console.warn('Failed to fetch prices:', err);
      setError('Failed to fetch prices. Please check your internet connection.');
      setLoading(false);
    }
  }, [triggerFlash]);

  // Start polling
  const startPolling = useCallback(() => {
    fetchPrices();
    intervalRef.current = setInterval(fetchPrices, POLL_INTERVAL);
  }, [fetchPrices]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchExchangeRate();
    startPolling();

    // Refresh exchange rate every 30 minutes (free API updates daily)
    exchangeRateIntervalRef.current = setInterval(fetchExchangeRate, EXCHANGE_RATE_POLL_INTERVAL);

    // Handle app state changes - pause polling when app goes to background
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/active/) &&
        nextAppState.match(/inactive|background/)
      ) {
        stopPolling();
      } else if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // Re-fetch exchange rate when app comes back to foreground
        fetchExchangeRate();
        startPolling();
      }
      appState.current = nextAppState;
    });

    return () => {
      stopPolling();
      if (exchangeRateIntervalRef.current) {
        clearInterval(exchangeRateIntervalRef.current);
      }
      subscription.remove();
    };
  }, [fetchExchangeRate, startPolling, stopPolling]);

  // Interstitial ad event listeners
  useEffect(() => {
    if (!interstitial) return;

    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      isInterstitialLoaded.current = true;
    });

    const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      // Reload ad for next time
      isInterstitialLoaded.current = false;
      interstitial.load();
    });

    // Start loading the first interstitial
    interstitial.load();

    return () => {
      loadedListener();
      closedListener();
    };
  }, []);

  const formatUSD = (price) => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  };

  const formatINR = (price, applyDuty = false) => {
    if (!usdToInr) return '...';
    let inrPrice = price * usdToInr;
    if (applyDuty) {
      inrPrice *= INDIA_DUTY_MULTIPLIER;
    }
    return `₹${inrPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Convert price per troy ounce to price per grams
  const pricePerGrams = (pricePerOz, grams) => {
    return (pricePerOz / TROY_OZ_TO_GRAMS) * grams;
  };

  // Convert price per pound to price per kg
  const pricePerKg = (pricePerLb) => {
    return pricePerLb / LBS_TO_KG;
  };

  const formatTime = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    fetchExchangeRate();
    startPolling();
  };

  const getFilteredCommodities = () => {
    if (activeCategory === 'all') return COMMODITIES;
    return COMMODITIES.filter(c => c.category === activeCategory);
  };

  const renderCommodityCard = (commodity) => {
    const priceData = prices[commodity.symbol];
    if (!priceData) return null;

    const hasTaxData = !!COUNTRY_TAX_DATA[commodity.symbol];

    return (
      <TouchableOpacity
        key={commodity.symbol}
        style={[
          styles.priceCard,
          { backgroundColor: commodity.cardBg, borderColor: commodity.borderColor },
        ]}
        activeOpacity={hasTaxData ? 0.85 : 1}
        onPress={hasTaxData ? () => setDetailModalSymbol(commodity.symbol) : undefined}
      >
        <Animated.View
          style={[
            styles.flashOverlay,
            {
              backgroundColor: flashColors[commodity.symbol],
              opacity: flashAnims[commodity.symbol],
            },
          ]}
        />

        {/* Card Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.metalIcon}>{commodity.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.metalName}>{priceData.name || commodity.name}</Text>
            <Text style={styles.metalSymbol}>{priceData.symbol || commodity.symbol}</Text>
          </View>
          {hasTaxData && (
            <View style={[styles.tapHintBadge, { borderColor: commodity.accentColor + '30' }]}>
              <Text style={[styles.tapHintText, { color: commodity.accentColor }]}>Tap for 🌍 rates</Text>
            </View>
          )}
          <View style={[styles.categoryBadge, { borderColor: commodity.accentColor + '40' }]}>
            <Text style={[styles.categoryBadgeText, { color: commodity.accentColor }]}>
              {commodity.category === 'precious' ? 'PRECIOUS' :
               commodity.category === 'industrial' ? 'INDUSTRIAL' : 'CRYPTO'}
            </Text>
          </View>
        </View>

        {/* Primary Price */}
        <Text style={styles.unitLabel}>{commodity.unitLabel}</Text>
        <View style={styles.priceRow}>
          <View style={styles.priceColumn}>
            <Text style={styles.currencyLabel}>USD</Text>
            <Text style={[styles.priceValue, { color: commodity.accentColor }]}>
              {formatUSD(priceData.price)}
            </Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceColumn}>
            <Text style={styles.currencyLabel}>
              {commodity.category === 'precious' || commodity.category === 'industrial'
                ? 'INR (incl. duty)' : 'INR'}
            </Text>
            <Text style={[styles.priceValue, { color: commodity.accentColor }]}>
              {formatINR(priceData.price, commodity.category === 'precious' || commodity.category === 'industrial')}
            </Text>
          </View>
        </View>

        {/* Secondary Price (gram/kg conversions for metals) */}
        {commodity.secondaryUnit && (
          <>
            <Text style={styles.unitLabel}>{commodity.secondaryUnit.label}</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>USD</Text>
                <Text style={[styles.priceValue, { color: commodity.accentColor }]}>
                  {commodity.unit === 'lb'
                    ? formatUSD(pricePerKg(priceData.price))
                    : formatUSD(pricePerGrams(priceData.price, commodity.secondaryUnit.grams))
                  }
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>
                  {commodity.category === 'precious' || commodity.category === 'industrial'
                    ? 'INR (incl. duty)' : 'INR'}
                </Text>
                <Text style={[styles.priceValue, { color: commodity.accentColor }]}>
                  {commodity.unit === 'lb'
                    ? formatINR(pricePerKg(priceData.price), true)
                    : formatINR(pricePerGrams(priceData.price, commodity.secondaryUnit.grams),
                        commodity.category === 'precious' || commodity.category === 'industrial')
                  }
                </Text>
              </View>
            </View>
          </>
        )}
      </TouchableOpacity>
    );
  };

  // Render commodity detail modal with country-wise rates
  const renderDetailModal = () => {
    if (!detailModalSymbol) return null;
    const commodityData = prices[detailModalSymbol];
    const commodityConfig = COMMODITIES.find(c => c.symbol === detailModalSymbol);
    const countryList = COUNTRY_TAX_DATA[detailModalSymbol];
    if (!commodityData || !commodityConfig || !countryList) return null;

    const spotPrice = commodityData.price;
    const isCrypto = commodityConfig.category === 'crypto';
    const isCopper = detailModalSymbol === 'HG';

    // Determine display unit & price
    let unitPriceUSD, col3Label, col4Label, disclaimerText;
    if (isCrypto) {
      unitPriceUSD = spotPrice; // per 1 coin
      col3Label = '1 Coin (USD)';
      col4Label = '1 Coin (INR)';
      disclaimerText = '⚠️ Tax rates shown are capital gains / transaction taxes for individuals. Actual rates depend on holding period, income, and jurisdiction.';
    } else if (isCopper) {
      unitPriceUSD = pricePerKg(spotPrice); // per kg
      col3Label = '1 Kg (USD)';
      col4Label = '1 Kg (INR)';
      disclaimerText = '⚠️ Duty rates are for refined copper cathode. Rates vary by product form (wire, scrap, alloys). Verify with local customs.';
    } else {
      unitPriceUSD = pricePerGrams(spotPrice, 10); // per 10g
      col3Label = '10g (USD)';
      col4Label = '10g (INR)';
      disclaimerText = '⚠️ Tax rates are for investment-grade bullion. Jewelry may attract higher duties. Rates may vary — verify with local authorities.';
    }

    const spotLabel = isCrypto
      ? `Spot: ${formatUSD(spotPrice)}/coin`
      : isCopper
        ? `Spot: ${formatUSD(spotPrice)}/lb`
        : `Spot: ${formatUSD(spotPrice)}/oz`;

    return (
      <Modal
        visible={!!detailModalSymbol}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDetailModalSymbol(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { borderColor: commodityConfig.accentColor + '60' }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {commodityConfig.icon} {commodityConfig.name} Rates Worldwide
                </Text>
                <Text style={styles.modalSubtitle}>{spotLabel}</Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setDetailModalSymbol(null)}
              >
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { flex: 2.2 }]}>Country</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>
                {isCrypto ? 'Tax %' : 'Duty %'}
              </Text>
              <Text style={[styles.tableHeaderText, { flex: 1.6, textAlign: 'right' }]}>{col3Label}</Text>
              <Text style={[styles.tableHeaderText, { flex: 1.8, textAlign: 'right' }]}>{col4Label}</Text>
            </View>

            {/* Country Rows */}
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {countryList.map((country, index) => {
                const taxMultiplier = 1 + (country.taxPercent / 100);
                const priceWithTaxUSD = unitPriceUSD * taxMultiplier;
                const priceWithTaxINR = usdToInr ? priceWithTaxUSD * usdToInr : 0;
                const isIndia = country.name === 'India';

                return (
                  <View
                    key={country.name}
                    style={[
                      styles.countryRow,
                      isIndia && styles.countryRowHighlight,
                      index % 2 === 0 && styles.countryRowAlt,
                    ]}
                  >
                    <View style={{ flex: 2.2 }}>
                      <View style={styles.countryNameRow}>
                        <Text style={styles.countryFlag}>{country.flag}</Text>
                        <Text style={[
                          styles.countryName,
                          isIndia && { color: commodityConfig.accentColor, fontWeight: '700' },
                        ]} numberOfLines={1}>{country.name}</Text>
                      </View>
                      <Text style={styles.countryTaxLabel} numberOfLines={1}>{country.taxLabel}</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <View style={[
                        styles.taxBadge,
                        country.taxPercent === 0 && styles.taxBadgeFree,
                        country.taxPercent > 10 && styles.taxBadgeHigh,
                      ]}>
                        <Text style={[
                          styles.taxBadgeText,
                          country.taxPercent === 0 && styles.taxBadgeTextFree,
                          country.taxPercent > 10 && styles.taxBadgeTextHigh,
                        ]}>{country.taxPercent === 0 ? '0%' : `${country.taxPercent}%`}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1.6, alignItems: 'flex-end' }}>
                      <Text style={[
                        styles.countryPrice,
                        isIndia && { color: commodityConfig.accentColor },
                      ]}>{formatUSD(priceWithTaxUSD)}</Text>
                    </View>
                    <View style={{ flex: 1.8, alignItems: 'flex-end' }}>
                      <Text style={[
                        styles.countryPriceINR,
                        isIndia && { color: commodityConfig.accentColor },
                      ]}>
                        {usdToInr
                          ? `₹${priceWithTaxINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
                          : '...'}
                      </Text>
                    </View>
                  </View>
                );
              })}
              <View style={styles.modalDisclaimer}>
                <Text style={styles.modalDisclaimerText}>{disclaimerText}</Text>
              </View>
            </ScrollView>

            {/* Banner Ad in Modal */}
            <View style={styles.adContainer}>
              {isAdMobAvailable ? (
                <BannerAd
                  unitId={BANNER_AD_UNIT_ID}
                  size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                  requestOptions={{ requestNonPersonalizedAdsOnly: true }}
                />
              ) : (
                <View style={styles.adPlaceholder}>
                  <Text style={styles.adPlaceholderText}>📢 Ad Space</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#FFD700" />
          <Text style={styles.loadingText}>Fetching live rates...</Text>
          <Text style={styles.loadingSubText}>Loading 7 commodities</Text>
        </View>
        <View style={styles.adContainer}>
          {isAdMobAvailable ? (
            <BannerAd
              unitId={BANNER_AD_UNIT_ID}
              size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            />
          ) : (
            <View style={styles.adPlaceholder}>
              <Text style={styles.adPlaceholderText}>📢 Ad Space</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (error && Object.keys(prices).length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.adContainer}>
          {isAdMobAvailable ? (
            <BannerAd
              unitId={BANNER_AD_UNIT_ID}
              size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
              requestOptions={{ requestNonPersonalizedAdsOnly: true }}
            />
          ) : (
            <View style={styles.adPlaceholder}>
              <Text style={styles.adPlaceholderText}>📢 Ad Space</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  const filteredCommodities = getFilteredCommodities();
  const loadedCount = Object.keys(prices).length;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>💰 GoldBullion</Text>
            <Text style={styles.headerSubtitle}>Live Commodity & Crypto Prices</Text>
          </View>
          {lastUpdated && (
            <View style={styles.liveIndicator}>
              <Text style={styles.liveDot}>●</Text>
              <Text style={styles.liveText}>LIVE</Text>
              <Text style={styles.liveTime}>{formatTime(lastUpdated)}</Text>
            </View>
          )}
        </View>

        {/* Category Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryScrollContent}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={[
                styles.categoryTab,
                activeCategory === cat.key && styles.categoryTabActive,
              ]}
              onPress={() => setActiveCategory(cat.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.categoryTabIcon}>{cat.icon}</Text>
              <Text
                style={[
                  styles.categoryTabText,
                  activeCategory === cat.key && styles.categoryTabTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Count badge */}
        <View style={styles.countRow}>
          <Text style={styles.countText}>
            {filteredCommodities.length} {filteredCommodities.length === 1 ? 'asset' : 'assets'}
          </Text>
          <Text style={styles.countDot}>•</Text>
          <Text style={styles.countText}>{loadedCount} loaded</Text>
          <Text style={styles.countDot}>•</Text>
          <Text style={styles.countText}>Auto-refresh 5s</Text>
        </View>

        {/* Commodity Cards */}
        {filteredCommodities.map(renderCommodityCard)}

        {/* Info */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️ About Prices</Text>
          <Text style={styles.infoText}>
            Metals: priced per troy ounce (oz) with gram/kg conversions{'\n'}
            Copper: priced per pound (lb) with kg conversion{'\n'}
            Crypto: priced per 1 coin{'\n'}
            All prices in USD & INR • Auto-refreshes every 5 seconds
          </Text>
          <View style={styles.dutyInfoRow}>
            <Text style={styles.dutyInfoIcon}>🇮🇳</Text>
            <Text style={styles.dutyInfoText}>
              INR prices for metals include India import duty:{' '}
              BCD 10% + AIDC 5% + GST 3% (≈18.5% total)
            </Text>
          </View>
          <Text style={styles.infoFree}>🆓 All data is free with no rate limits</Text>
        </View>
      </ScrollView>

      {/* Gold Detail Modal */}
      {renderDetailModal()}

      {/* AdMob Banner */}
      <View style={styles.adContainer}>
        {isAdMobAvailable ? (
          <BannerAd
            unitId={BANNER_AD_UNIT_ID}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        ) : (
          <View style={styles.adPlaceholder}>
            <Text style={styles.adPlaceholderText}>
              📢 Ad Space (AdMob loads in production build)
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0D1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#8B949E',
    fontSize: 16,
    marginTop: 16,
    fontWeight: '500',
  },
  loadingSubText: {
    color: '#484F58',
    fontSize: 13,
    marginTop: 6,
    fontWeight: '400',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#F85149',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#FFD700',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#0D1117',
    fontSize: 16,
    fontWeight: '700',
  },

  // Header
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#161B22',
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#8B949E',
    marginTop: 3,
    fontWeight: '500',
  },
  liveIndicator: {
    alignItems: 'center',
    backgroundColor: '#0D1117',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1B3D2F',
  },
  liveDot: {
    color: '#3FB950',
    fontSize: 10,
  },
  liveText: {
    color: '#3FB950',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 1,
  },
  liveTime: {
    color: '#8B949E',
    fontSize: 9,
    marginTop: 2,
    fontWeight: '500',
  },

  // Category Tabs
  categoryScroll: {
    marginTop: 14,
  },
  categoryScrollContent: {
    paddingRight: 8,
    gap: 8,
  },
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#21262D',
  },
  categoryTabActive: {
    backgroundColor: '#1F2937',
    borderColor: '#FFD700',
  },
  categoryTabIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  categoryTabText: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryTabTextActive: {
    color: '#FFD700',
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },

  // Count Row
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  countText: {
    color: '#484F58',
    fontSize: 11,
    fontWeight: '500',
  },
  countDot: {
    color: '#484F58',
    fontSize: 11,
    marginHorizontal: 8,
  },

  // Price Cards
  priceCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    zIndex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  metalIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  metalName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metalSymbol: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 2,
    fontWeight: '500',
  },
  categoryBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  unitLabel: {
    fontSize: 11,
    color: '#6E7681',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 10,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D1117',
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
  },
  priceColumn: {
    flex: 1,
    alignItems: 'center',
  },
  priceDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#21262D',
  },
  currencyLabel: {
    fontSize: 10,
    color: '#8B949E',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 5,
    textAlign: 'center',
  },
  priceValue: {
    fontSize: 16,
    fontWeight: '700',
  },

  // Info Box
  infoBox: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#21262D',
  },
  infoTitle: {
    color: '#8B949E',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  infoText: {
    color: '#484F58',
    fontSize: 11,
    lineHeight: 18,
  },
  dutyInfoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 10,
    backgroundColor: '#1C1A0F',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#3D350830',
  },
  dutyInfoIcon: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 1,
  },
  dutyInfoText: {
    color: '#C9A84C',
    fontSize: 11,
    fontWeight: '500',
    flex: 1,
    lineHeight: 16,
  },
  infoFree: {
    color: '#3FB950',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },

  // Tap Hint Badge
  tapHintBadge: {
    backgroundColor: '#2D2408',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#FFD70030',
  },
  tapHintText: {
    color: '#FFD700',
    fontSize: 9,
    fontWeight: '700',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0D1117',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#3D3508',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#8B949E',
    marginTop: 4,
    fontWeight: '500',
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#21262D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseBtnText: {
    color: '#8B949E',
    fontSize: 16,
    fontWeight: '700',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#161B22',
    borderBottomWidth: 1,
    borderBottomColor: '#21262D',
  },
  tableHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6E7681',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  modalScroll: {
    paddingHorizontal: 0,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#161B2280',
  },
  countryRowAlt: {
    backgroundColor: '#0D111780',
  },
  countryRowHighlight: {
    backgroundColor: '#1C1A0F',
    borderLeftWidth: 3,
    borderLeftColor: '#FFD700',
  },
  countryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countryFlag: {
    fontSize: 16,
    marginRight: 6,
  },
  countryName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C9D1D9',
    flexShrink: 1,
  },
  countryTaxLabel: {
    fontSize: 9,
    color: '#484F58',
    marginTop: 2,
    marginLeft: 22,
  },
  taxBadge: {
    backgroundColor: '#21262D',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  taxBadgeFree: {
    backgroundColor: '#0D2818',
    borderWidth: 1,
    borderColor: '#1B3D2F',
  },
  taxBadgeHigh: {
    backgroundColor: '#2D1117',
    borderWidth: 1,
    borderColor: '#3D1F28',
  },
  taxBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8B949E',
  },
  taxBadgeTextFree: {
    color: '#3FB950',
  },
  taxBadgeTextHigh: {
    color: '#F85149',
  },
  countryPrice: {
    fontSize: 12,
    fontWeight: '600',
    color: '#C9D1D9',
  },
  countryPriceINR: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E5C07B',
  },
  modalDisclaimer: {
    padding: 16,
    paddingBottom: 40,
  },
  modalDisclaimerText: {
    color: '#484F58',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },

  // Ad
  adContainer: {
    alignItems: 'center',
    backgroundColor: '#161B22',
    borderTopWidth: 1,
    borderTopColor: '#21262D',
    paddingVertical: 4,
  },
  adPlaceholder: {
    backgroundColor: '#21262D',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginVertical: 4,
    width: '90%',
    alignItems: 'center',
  },
  adPlaceholderText: {
    color: '#8B949E',
    fontSize: 12,
    fontWeight: '500',
  },
});
