import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  Animated,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useCreateAlert } from '../api/alerts';

type PanicState = 'idle' | 'holding' | 'confirming' | 'sent' | 'error';

const HOLD_DURATION_MS = 3000;
const TICK_INTERVAL_MS = 50;

export function PanicScreen() {
  const { user } = useAuth();
  const createAlert = useCreateAlert();

  const [state, setState] = useState<PanicState>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const holdStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulsing animation for the idle button
  useEffect(() => {
    if (state === 'idle') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state, pulseAnim]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handlePressIn = useCallback(() => {
    if (state !== 'idle') return;

    setState('holding');
    setProgress(0);
    holdStartRef.current = Date.now();
    Vibration.vibrate(50);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setProgress(pct);

      if (pct >= 1) {
        clearTimer();
        setState('confirming');
        Vibration.vibrate([0, 200, 100, 200, 100, 200]);
      }
    }, TICK_INTERVAL_MS);
  }, [state, clearTimer]);

  const handlePressOut = useCallback(() => {
    if (state === 'holding') {
      // Released too early -- cancel
      clearTimer();
      setState('idle');
      setProgress(0);
    }
  }, [state, clearTimer]);

  const handleConfirm = useCallback(async () => {
    if (state !== 'confirming') return;

    try {
      setState('sent');
      Vibration.vibrate([0, 300, 100, 300]);
      await createAlert.mutateAsync({
        level: 'ACTIVE_THREAT',
        buildingId: '',
        source: 'MOBILE_APP',
        message: `Panic alert from ${user?.name || 'unknown user'}`,
      });
    } catch (err) {
      setState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send alert');
    }
  }, [state, createAlert, user?.name]);

  const handleCancel = useCallback(() => {
    clearTimer();
    setState('idle');
    setProgress(0);
    setErrorMsg('');
  }, [clearTimer]);

  const handleReset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setErrorMsg('');
  }, []);

  // -- IDLE state: show the panic button --
  if (state === 'idle' || state === 'holding') {
    const progressAngle = Math.round(progress * 360);
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Emergency</Text>
        </View>

        <View style={styles.centerContent}>
          <Text style={styles.instructionText}>
            Press and hold for 3 seconds
          </Text>

          <Animated.View style={[styles.buttonOuter, { transform: [{ scale: pulseAnim }] }]}>
            {/* Progress ring background */}
            {state === 'holding' && (
              <View style={styles.progressRing}>
                <Text style={styles.progressText}>{Math.ceil((1 - progress) * 3)}s</Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.panicButton,
                state === 'holding' && styles.panicButtonHolding,
              ]}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.9}
            >
              <Text style={styles.panicText}>PANIC</Text>
              {state === 'idle' && (
                <Text style={styles.panicSubtext}>Hold to activate</Text>
              )}
              {state === 'holding' && (
                <View style={styles.holdBar}>
                  <View style={[styles.holdBarFill, { width: `${progress * 100}%` }]} />
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Text style={styles.warningText}>
            This will immediately alert all staff{'\n'}and dispatch emergency services.
          </Text>
        </View>
      </View>
    );
  }

  // -- CONFIRMING state: final confirmation --
  if (state === 'confirming') {
    return (
      <View style={[styles.container, styles.confirmContainer]}>
        <View style={styles.confirmContent}>
          <Text style={styles.confirmTitle}>Confirm Emergency Alert</Text>
          <Text style={styles.confirmMessage}>
            This will immediately notify all staff and contact 911 dispatch.
            {'\n\n'}
            Are you sure this is a real emergency?
          </Text>

          <TouchableOpacity
            style={styles.confirmButton}
            onPress={handleConfirm}
            activeOpacity={0.8}
          >
            <Text style={styles.confirmButtonText}>SEND ALERT NOW</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // -- SENT state: confirmation that alert was sent --
  if (state === 'sent') {
    return (
      <View style={[styles.container, styles.sentContainer]}>
        <View style={styles.sentContent}>
          <View style={styles.sentIcon}>
            <Text style={styles.sentIconText}>!</Text>
          </View>
          <Text style={styles.sentTitle}>Alert Sent</Text>
          <Text style={styles.sentMessage}>
            Emergency services have been notified.{'\n'}
            All staff have received the alert.
          </Text>
          <Text style={styles.sentInstruction}>
            Follow your site's emergency procedures.{'\n'}
            Stay calm and await further instructions.
          </Text>

          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            activeOpacity={0.7}
          >
            <Text style={styles.resetButtonText}>Return</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // -- ERROR state --
  return (
    <View style={[styles.container, styles.errorContainer]}>
      <View style={styles.errorContent}>
        <Text style={styles.errorTitle}>Alert Failed</Text>
        <Text style={styles.errorMessage}>{errorMsg}</Text>
        <Text style={styles.errorInstruction}>
          If this is a real emergency, call 911 directly.
        </Text>

        <TouchableOpacity
          style={styles.retryButton}
          onPress={handleConfirm}
          activeOpacity={0.8}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={handleReset}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111827',
  },
  header: {
    padding: 16,
    paddingTop: 56,
    backgroundColor: '#1f2937',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  instructionText: {
    color: '#9ca3af',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
  },
  buttonOuter: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  progressRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 4,
    borderColor: '#fca5a5',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: -1,
  },
  progressText: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: 'bold',
    position: 'absolute',
    top: -24,
  },
  panicButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  panicButtonHolding: {
    backgroundColor: '#991b1b',
    shadowOpacity: 0.8,
    shadowRadius: 30,
  },
  panicText: {
    color: '#fff',
    fontSize: 42,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  panicSubtext: {
    color: '#fecaca',
    fontSize: 13,
    marginTop: 4,
  },
  holdBar: {
    width: 120,
    height: 6,
    backgroundColor: '#450a0a',
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  holdBarFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 3,
  },
  warningText: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Confirming
  confirmContainer: {
    backgroundColor: '#1c1917',
  },
  confirmContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  confirmTitle: {
    color: '#fca5a5',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  confirmMessage: {
    color: '#d1d5db',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 40,
  },
  confirmButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '600',
  },

  // Sent
  sentContainer: {
    backgroundColor: '#14532d',
  },
  sentContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  sentIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  sentIconText: {
    color: '#fff',
    fontSize: 40,
    fontWeight: 'bold',
  },
  sentTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  sentMessage: {
    color: '#bbf7d0',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  sentInstruction: {
    color: '#86efac',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
  },
  resetButton: {
    backgroundColor: '#166534',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  resetButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // Error
  errorContainer: {
    backgroundColor: '#450a0a',
  },
  errorContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    color: '#fca5a5',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  errorMessage: {
    color: '#fecaca',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorInstruction: {
    color: '#f87171',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 32,
    fontWeight: '600',
  },
  retryButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginBottom: 12,
    width: '100%',
    alignItems: 'center',
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
