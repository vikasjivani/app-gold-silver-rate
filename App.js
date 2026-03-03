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

const GOLD_API = 'https://api.gold-api.com/price/XAU';
const SILVER_API = 'https://api.gold-api.com/price/XAG';
const EXCHANGE_RATE_API = 'https://open.er-api.com/v6/latest/USD';
const POLL_INTERVAL = 5000; // 5 seconds
const TROY_OZ_TO_GRAMS = 28.35; // 1 ounce = 28.35 grams

// Real AdMob unit IDs
const BANNER_AD_UNIT_ID = 'ca-app-pub-3789345794133466/9199212756';
const INTERSTITIAL_AD_UNIT_ID = 'ca-app-pub-3789345794133466/6892613614';

// Create interstitial ad instance (outside component to persist across renders)
const interstitial = isAdMobAvailable
  ? InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID, {
    requestNonPersonalizedAdsOnly: true,
  })
  : null;

export default function App() {
  const [goldPrice, setGoldPrice] = useState(null);
  const [silverPrice, setSilverPrice] = useState(null);
  const [usdToInr, setUsdToInr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const prevGoldPrice = useRef(null);
  const prevSilverPrice = useRef(null);
  const goldFlash = useRef(new Animated.Value(0)).current;
  const silverFlash = useRef(new Animated.Value(0)).current;
  const [goldFlashColor, setGoldFlashColor] = useState('#3FB950');
  const [silverFlashColor, setSilverFlashColor] = useState('#3FB950');

  // Interstitial ad state
  const refreshCountRef = useRef(0);
  const isInterstitialLoaded = useRef(false);

  // Fetch exchange rate (once on mount)
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
  const triggerFlash = useCallback((animValue, setColor, direction) => {
    setColor(direction === 'up' ? '#3FB950' : '#F85149');
    animValue.setValue(0.35);
    Animated.timing(animValue, {
      toValue: 0,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, []);

  // Fetch gold and silver prices
  const fetchPrices = useCallback(async () => {
    try {
      const [goldRes, silverRes] = await Promise.all([
        fetch(GOLD_API),
        fetch(SILVER_API),
      ]);
      const goldData = await goldRes.json();
      const silverData = await silverRes.json();

      if (goldData && goldData.price) {
        if (prevGoldPrice.current !== null && goldData.price !== prevGoldPrice.current) {
          triggerFlash(goldFlash, setGoldFlashColor, goldData.price > prevGoldPrice.current ? 'up' : 'down');
        }
        prevGoldPrice.current = goldData.price;
        setGoldPrice(goldData);
      }
      if (silverData && silverData.price) {
        if (prevSilverPrice.current !== null && silverData.price !== prevSilverPrice.current) {
          triggerFlash(silverFlash, setSilverFlashColor, silverData.price > prevSilverPrice.current ? 'up' : 'down');
        }
        prevSilverPrice.current = silverData.price;
        setSilverPrice(silverData);
      }
      setLastUpdated(new Date());
      setError(null);
      setLoading(false);

      // Show interstitial ad every 3 refreshes
      refreshCountRef.current += 1;
      if (refreshCountRef.current % 3 === 0 && isInterstitialLoaded.current && interstitial) {
        interstitial.show();
        isInterstitialLoaded.current = false;
      }
    } catch (err) {
      console.warn('Failed to fetch prices:', err);
      setError('Failed to fetch prices. Please check your internet connection.');
      setLoading(false);
    }
  }, [goldFlash, silverFlash, triggerFlash]);

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
        startPolling();
      }
      appState.current = nextAppState;
    });

    return () => {
      stopPolling();
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
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatINR = (price) => {
    if (!usdToInr) return '...';
    const inrPrice = price * usdToInr;
    return `₹${inrPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Convert price per troy ounce to price per grams
  const pricePerGrams = (pricePerOz, grams) => {
    return (pricePerOz / TROY_OZ_TO_GRAMS) * grams;
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#FFD700" />
        <Text style={styles.loadingText}>Fetching live rates...</Text>
      </View>
    );
  }

  if (error && !goldPrice && !silverPrice) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="light" />
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>💰 GoldBullion</Text>
            <Text style={styles.headerSubtitle}>Live Gold & Silver Prices</Text>
          </View>
          {lastUpdated && (
            <View style={styles.liveIndicator}>
              <Text style={styles.liveDot}>●</Text>
              <Text style={styles.liveText}>LIVE</Text>
              <Text style={styles.liveTime}>{formatTime(lastUpdated)}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Gold Card */}
        {goldPrice && (
          <View style={[styles.priceCard, styles.goldCard]}>
            <Animated.View style={[styles.flashOverlay, { backgroundColor: goldFlashColor, opacity: goldFlash }]} />
            <View style={styles.cardHeader}>
              <Text style={styles.metalIcon}>🥇</Text>
              <View>
                <Text style={styles.metalName}>{goldPrice.name}</Text>
                <Text style={styles.metalSymbol}>{goldPrice.symbol}</Text>
              </View>
            </View>

            {/* Per Troy Ounce */}
            <Text style={styles.unitLabel}>Per Troy Ounce (oz)</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>USD</Text>
                <Text style={[styles.priceValue, styles.goldText]}>
                  {formatUSD(goldPrice.price)}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>INR</Text>
                <Text style={[styles.priceValue, styles.goldText]}>
                  {formatINR(goldPrice.price)}
                </Text>
              </View>
            </View>

            {/* Per 10 Grams */}
            <Text style={styles.unitLabel}>Per 10 Grams</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>USD</Text>
                <Text style={[styles.priceValue, styles.goldText]}>
                  {formatUSD(pricePerGrams(goldPrice.price, 10))}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>INR</Text>
                <Text style={[styles.priceValue, styles.goldText]}>
                  {formatINR(pricePerGrams(goldPrice.price, 10))}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Silver Card */}
        {silverPrice && (
          <View style={[styles.priceCard, styles.silverCard]}>
            <Animated.View style={[styles.flashOverlay, { backgroundColor: silverFlashColor, opacity: silverFlash }]} />
            <View style={styles.cardHeader}>
              <Text style={styles.metalIcon}>🥈</Text>
              <View>
                <Text style={styles.metalName}>{silverPrice.name}</Text>
                <Text style={styles.metalSymbol}>{silverPrice.symbol}</Text>
              </View>
            </View>

            {/* Per Troy Ounce */}
            <Text style={styles.unitLabel}>Per Troy Ounce (oz)</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>USD</Text>
                <Text style={[styles.priceValue, styles.silverText]}>
                  {formatUSD(silverPrice.price)}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>INR</Text>
                <Text style={[styles.priceValue, styles.silverText]}>
                  {formatINR(silverPrice.price)}
                </Text>
              </View>
            </View>

            {/* Per 1 KG */}
            <Text style={styles.unitLabel}>Per 1 Kilogram</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>USD</Text>
                <Text style={[styles.priceValue, styles.silverText]}>
                  {formatUSD(pricePerGrams(silverPrice.price, 1000))}
                </Text>
              </View>
              <View style={styles.priceDivider} />
              <View style={styles.priceColumn}>
                <Text style={styles.currencyLabel}>INR</Text>
                <Text style={[styles.priceValue, styles.silverText]}>
                  {formatINR(pricePerGrams(silverPrice.price, 1000))}
                </Text>
              </View>
            </View>
          </View>
        )}



        {/* Info */}
        <Text style={styles.infoText}>
          Gold: per oz {'&'} per 10g • Silver: per oz {'&'} per 1kg{`\n`}Auto-refreshes every 5 seconds.
        </Text>
      </ScrollView>

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
    paddingBottom: 16,
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
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8B949E',
    marginTop: 4,
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

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },

  // Price Cards
  priceCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
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
  goldCard: {
    backgroundColor: '#1C1A0F',
    borderColor: '#3D3508',
  },
  silverCard: {
    backgroundColor: '#141618',
    borderColor: '#2A2D31',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  metalIcon: {
    fontSize: 36,
    marginRight: 12,
  },
  metalName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  metalSymbol: {
    fontSize: 13,
    color: '#8B949E',
    marginTop: 2,
    fontWeight: '500',
  },
  unitLabel: {
    fontSize: 11,
    color: '#6E7681',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
    marginTop: 12,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D1117',
    borderRadius: 12,
    padding: 16,
    marginBottom: 4,
  },
  priceColumn: {
    flex: 1,
    alignItems: 'center',
  },
  priceDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#21262D',
  },
  currencyLabel: {
    fontSize: 12,
    color: '#8B949E',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  goldText: {
    color: '#FFD700',
  },
  silverText: {
    color: '#C0C0C0',
  },

  // Info
  infoText: {
    color: '#484F58',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
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
