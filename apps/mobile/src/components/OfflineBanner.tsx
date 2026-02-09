import { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

interface OfflineBannerProps {
  isOnline: boolean;
}

export function OfflineBanner({ isOnline }: OfflineBannerProps) {
  const [visible, setVisible] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);
  const wasOfflineRef = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isOnline) {
      // Going offline -- show the banner
      wasOfflineRef.current = true;
      setShowReconnected(false);
      setVisible(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (wasOfflineRef.current) {
      // Coming back online -- flash green "reconnected" briefly
      wasOfflineRef.current = false;
      setShowReconnected(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }).start(() => {
          setVisible(false);
          setShowReconnected(false);
        });
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      // Online from the start -- hide
      setVisible(false);
    }
  }, [isOnline, fadeAnim]);

  if (!visible && !showReconnected && isOnline) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        showReconnected ? styles.bannerOnline : styles.bannerOffline,
        { opacity: fadeAnim },
      ]}
    >
      <Text style={styles.bannerText}>
        {showReconnected
          ? 'Back online -- syncing queued actions...'
          : 'No connection -- working offline'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingTop: 48,
    paddingBottom: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  bannerOffline: {
    backgroundColor: '#b45309',
  },
  bannerOnline: {
    backgroundColor: '#15803d',
  },
  bannerText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
