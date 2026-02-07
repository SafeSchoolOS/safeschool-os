import { View, Text, TouchableOpacity, FlatList, RefreshControl, StyleSheet, Alert, Vibration } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useAlerts, useCreateAlert } from '../api/alerts';

export function HomeScreen() {
  const { user, logout } = useAuth();
  const siteId = user?.siteIds[0];
  const { data: alerts, isLoading, refetch } = useAlerts(siteId);
  const createAlert = useCreateAlert();

  const handlePanic = () => {
    Alert.alert(
      'CONFIRM PANIC ALERT',
      'This will immediately alert all staff and dispatch emergency services. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'SEND ALERT',
          style: 'destructive',
          onPress: async () => {
            try {
              Vibration.vibrate([0, 200, 100, 200]);
              await createAlert.mutateAsync({
                level: 'ACTIVE_THREAT',
                buildingId: '', // Will be resolved server-side from user's site
                source: 'MOBILE_APP',
                message: `Panic alert from ${user?.name}`,
              });
              Alert.alert('Alert Sent', 'Emergency services have been notified.');
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send alert');
            }
          },
        },
      ],
    );
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'ACTIVE_THREAT': return '#dc2626';
      case 'LOCKDOWN': return '#ea580c';
      case 'FIRE': return '#d97706';
      case 'MEDICAL': return '#2563eb';
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
      case 'CANCELLED': return { bg: '#6b7280', text: 'CANCELLED' };
      default: return { bg: '#6b7280', text: status };
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SafeSchool</Text>
          <Text style={styles.headerSubtitle}>{user?.name}</Text>
        </View>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.logout}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.panicButton, createAlert.isPending && styles.panicButtonDisabled]}
        onPress={handlePanic}
        disabled={createAlert.isPending}
        activeOpacity={0.7}
      >
        <Text style={styles.panicText}>PANIC</Text>
        <Text style={styles.panicSubtext}>Tap to send emergency alert</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Recent Alerts</Text>

      <FlatList
        data={alerts || []}
        keyExtractor={(item: any) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#fff" />}
        renderItem={({ item }: { item: any }) => {
          const badge = getStatusBadge(item.status);
          return (
            <View style={[styles.alertCard, { borderLeftColor: getLevelColor(item.level) }]}>
              <View style={styles.alertHeader}>
                <Text style={styles.alertLevel}>{item.level}</Text>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.statusText}>{badge.text}</Text>
                </View>
              </View>
              <Text style={styles.alertLocation}>{item.buildingName}{item.roomName ? ` - ${item.roomName}` : ''}</Text>
              {item.message && <Text style={styles.alertMessage}>{item.message}</Text>}
              <Text style={styles.alertTime}>{new Date(item.triggeredAt).toLocaleString()}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No alerts</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 56, backgroundColor: '#1f2937' },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  headerSubtitle: { color: '#9ca3af', fontSize: 14 },
  logout: { color: '#9ca3af', fontSize: 14 },
  panicButton: { backgroundColor: '#dc2626', margin: 16, padding: 32, borderRadius: 24, alignItems: 'center' },
  panicButtonDisabled: { opacity: 0.6 },
  panicText: { color: '#fff', fontSize: 48, fontWeight: 'bold', letterSpacing: 4 },
  panicSubtext: { color: '#fecaca', fontSize: 14, marginTop: 8 },
  sectionTitle: { color: '#9ca3af', fontSize: 14, fontWeight: '600', marginHorizontal: 16, marginTop: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  alertCard: { backgroundColor: '#1f2937', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 12, borderLeftWidth: 4 },
  alertHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  alertLevel: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  alertLocation: { color: '#d1d5db', fontSize: 14 },
  alertMessage: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  alertTime: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 32, fontSize: 16 },
});
