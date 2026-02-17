import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Dimensions, RefreshControl, Vibration, Platform } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useAlerts } from '../api/alerts';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

export function MonitorScreen() {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];
  const { data: alerts, isLoading, refetch } = useAlerts(siteId);
  const [now, setNow] = useState(new Date());
  const prevAlertCount = useRef<number | null>(null);

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Vibrate on new alerts (haptic feedback instead of sound on mobile)
  useEffect(() => {
    if (!alerts) return;
    const count = alerts.length;
    if (prevAlertCount.current !== null && count > prevAlertCount.current) {
      if (Platform.OS !== 'web') {
        Vibration.vibrate([0, 300, 100, 300]);
      }
    }
    prevAlertCount.current = count;
  }, [alerts]);

  const activeAlerts = (alerts || []).filter((a: any) => a.status === 'TRIGGERED' || a.status === 'ACKNOWLEDGED');
  const recentAlerts = (alerts || []).slice(0, 20);

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ACTIVE_THREAT': return '#dc2626';
      case 'LOCKDOWN': return '#ea580c';
      case 'FIRE': return '#d97706';
      case 'MEDICAL': return '#2563eb';
      case 'WEATHER': return '#7c3aed';
      case 'ALL_CLEAR': return '#16a34a';
      default: return '#6b7280';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'TRIGGERED': return { bg: '#dc2626', text: 'ACTIVE' };
      case 'ACKNOWLEDGED': return { bg: '#d97706', text: 'ACK' };
      case 'DISPATCHED': return { bg: '#2563eb', text: 'DISPATCHED' };
      case 'RESOLVED': return { bg: '#16a34a', text: 'RESOLVED' };
      default: return { bg: '#6b7280', text: status };
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#fff" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Security Monitor</Text>
        <Text style={styles.subtitle}>{user?.name}</Text>
      </View>

      {/* Widget Grid */}
      <View style={[styles.grid, isTablet && styles.gridTablet]}>
        {/* Clock Widget */}
        <View style={[styles.widget, isTablet && styles.widgetTabletHalf]}>
          <Text style={styles.widgetTitle}>CLOCK</Text>
          <Text style={styles.clockTime}>
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
          <Text style={styles.clockDate}>
            {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>

        {/* Active Alerts Counter */}
        <View style={[
          styles.widget,
          isTablet && styles.widgetTabletHalf,
          activeAlerts.length > 0 && styles.widgetFlashing,
        ]}>
          <Text style={styles.widgetTitle}>ACTIVE ALERTS</Text>
          <Text style={[
            styles.bigNumber,
            activeAlerts.length > 0 ? { color: '#dc2626' } : { color: '#16a34a' },
          ]}>
            {activeAlerts.length}
          </Text>
          {activeAlerts.length > 0 && (
            <Text style={styles.alertSub}>
              {activeAlerts[0]?.level} — {activeAlerts[0]?.buildingName}
            </Text>
          )}
        </View>

        {/* Alert Log */}
        <View style={[styles.widget, isTablet && styles.widgetTabletFull]}>
          <Text style={styles.widgetTitle}>ALERT LOG</Text>
          {recentAlerts.length === 0 ? (
            <Text style={styles.emptyText}>No recent alerts</Text>
          ) : (
            recentAlerts.map((alert: any) => {
              const badge = getStatusBadge(alert.status);
              return (
                <View key={alert.id} style={[styles.alertRow, { borderLeftColor: getLevelColor(alert.level) }]}>
                  <View style={styles.alertRowHeader}>
                    <Text style={[styles.alertLevel, { color: getLevelColor(alert.level) }]}>{alert.level}</Text>
                    <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
                      <Text style={styles.statusPillText}>{badge.text}</Text>
                    </View>
                  </View>
                  <Text style={styles.alertLocation}>{alert.buildingName}</Text>
                  {alert.message && <Text style={styles.alertMsg} numberOfLines={1}>{alert.message}</Text>}
                  <Text style={styles.alertTime}>{new Date(alert.triggeredAt).toLocaleTimeString()}</Text>
                </View>
              );
            })
          )}
        </View>

        {/* Calendar Widget */}
        <View style={[styles.widget, isTablet && styles.widgetTabletHalf]}>
          <Text style={styles.widgetTitle}>CALENDAR</Text>
          <Text style={styles.calendarMonth}>
            {now.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </Text>
          <View style={styles.calendarGrid}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.calendarDayHeader}>{d}</Text>
            ))}
            {(() => {
              const year = now.getFullYear();
              const month = now.getMonth();
              const firstDay = new Date(year, month, 1).getDay();
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const today = now.getDate();
              const cells: (number | null)[] = [];
              for (let i = 0; i < firstDay; i++) cells.push(null);
              for (let d = 1; d <= daysInMonth; d++) cells.push(d);
              return cells.map((day, i) => (
                <View key={i} style={[styles.calendarCell, day === today && styles.calendarToday]}>
                  <Text style={[styles.calendarDay, day === today && styles.calendarTodayText]}>
                    {day || ''}
                  </Text>
                </View>
              ));
            })()}
          </View>
        </View>

        {/* Visitor Count (placeholder - uses alert data since we don't have visitor API on mobile yet) */}
        <View style={[styles.widget, isTablet && styles.widgetTabletHalf]}>
          <Text style={styles.widgetTitle}>STATUS</Text>
          <View style={styles.statusGrid}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: '#16a34a' }]} />
              <Text style={styles.statusLabel}>System Online</Text>
            </View>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: activeAlerts.length > 0 ? '#dc2626' : '#16a34a' }]} />
              <Text style={styles.statusLabel}>{activeAlerts.length > 0 ? 'Alert Active' : 'All Clear'}</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, paddingTop: 56, paddingBottom: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  subtitle: { color: '#94a3b8', fontSize: 14 },
  grid: { padding: 8 },
  gridTablet: { flexDirection: 'row', flexWrap: 'wrap' },
  widget: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  widgetTabletHalf: { width: '49%', marginHorizontal: '0.5%' },
  widgetTabletFull: { width: '99%', marginHorizontal: '0.5%' },
  widgetFlashing: { borderColor: '#dc2626', borderWidth: 2 },
  widgetTitle: { color: '#64748b', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  clockTime: { color: '#fff', fontSize: 40, fontWeight: 'bold', fontVariant: ['tabular-nums'], textAlign: 'center' },
  clockDate: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 4 },
  bigNumber: { fontSize: 56, fontWeight: 'bold', textAlign: 'center' },
  alertSub: { color: '#f87171', fontSize: 12, textAlign: 'center', marginTop: 4 },
  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  alertRow: { borderLeftWidth: 3, paddingLeft: 8, paddingVertical: 6, marginBottom: 4 },
  alertRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alertLevel: { fontSize: 12, fontWeight: 'bold' },
  statusPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  statusPillText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
  alertLocation: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  alertMsg: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  alertTime: { color: '#64748b', fontSize: 10, marginTop: 2 },
  calendarMonth: { color: '#e2e8f0', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDayHeader: { width: '14.28%', textAlign: 'center', color: '#64748b', fontSize: 10, marginBottom: 4 },
  calendarCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calendarToday: { backgroundColor: '#2563eb', borderRadius: 100 },
  calendarDay: { color: '#e2e8f0', fontSize: 12 },
  calendarTodayText: { color: '#fff', fontWeight: 'bold' },
  statusGrid: { gap: 12 },
  statusItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { color: '#e2e8f0', fontSize: 14 },
});
