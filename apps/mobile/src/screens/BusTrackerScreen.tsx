import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { TouchableOpacity } from 'react-native';

export function BusTrackerScreen({ navigation }: any) {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];

  const { data: buses, isLoading, refetch } = useQuery({
    queryKey: ['buses', siteId],
    queryFn: () => api.get(`/transportation/buses`),
    refetchInterval: 10000,
  });

  const { data: routes } = useQuery({
    queryKey: ['bus-routes', siteId],
    queryFn: () => api.get(`/transportation/routes`),
  });

  const getSpeedColor = (speed: number | null) => {
    if (!speed) return '#6b7280';
    if (speed < 10) return '#22c55e'; // Stopped/slow
    if (speed < 35) return '#eab308'; // Normal
    return '#ef4444'; // Fast
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>&larr; Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bus Tracker</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{(buses || []).filter((b: any) => b.isActive).length}</Text>
          <Text style={styles.summaryLabel}>Active</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{(buses || []).reduce((sum: number, b: any) => sum + (b.currentStudentCount || 0), 0)}</Text>
          <Text style={styles.summaryLabel}>Students</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{(routes || []).length}</Text>
          <Text style={styles.summaryLabel}>Routes</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Buses</Text>

      <FlatList
        data={buses || []}
        keyExtractor={(item: any) => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor="#fff" />}
        renderItem={({ item }: { item: any }) => (
          <View style={[styles.busCard, !item.isActive && styles.busInactive]}>
            <View style={styles.busLeft}>
              <View style={[styles.busIcon, { backgroundColor: item.isActive ? '#1d4ed8' : '#374151' }]}>
                <Text style={styles.busIconText}>#{item.busNumber}</Text>
              </View>
              <View>
                <Text style={styles.busNumber}>Bus {item.busNumber}</Text>
                <Text style={styles.busDetail}>
                  {item.currentStudentCount} students | Cap: {item.capacity}
                </Text>
                <View style={styles.featureRow}>
                  {item.hasRfidReader && <Text style={styles.featureBadge}>RFID</Text>}
                  {item.hasPanicButton && <Text style={styles.featureBadge}>PANIC</Text>}
                  {item.hasCameras && <Text style={styles.featureBadge}>CAM</Text>}
                </View>
              </View>
            </View>
            <View style={styles.busRight}>
              {item.isActive ? (
                <>
                  <View style={[styles.speedDot, { backgroundColor: getSpeedColor(item.currentSpeed) }]} />
                  <Text style={styles.speedText}>
                    {item.currentSpeed ? `${Math.round(item.currentSpeed)} mph` : 'Stationary'}
                  </Text>
                  {item.lastGpsAt && (
                    <Text style={styles.gpsTime}>
                      GPS: {new Date(item.lastGpsAt).toLocaleTimeString()}
                    </Text>
                  )}
                </>
              ) : (
                <Text style={styles.inactiveText}>Inactive</Text>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No buses configured</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 56, backgroundColor: '#1f2937' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  back: { color: '#60a5fa', fontSize: 16 },
  summaryRow: { flexDirection: 'row', gap: 12, margin: 16 },
  summaryCard: { flex: 1, backgroundColor: '#1f2937', padding: 16, borderRadius: 12, alignItems: 'center' },
  summaryNum: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  summaryLabel: { color: '#9ca3af', fontSize: 12, marginTop: 4, textTransform: 'uppercase' },
  sectionTitle: { color: '#9ca3af', fontSize: 14, fontWeight: '600', marginHorizontal: 16, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  busCard: { backgroundColor: '#1f2937', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  busInactive: { opacity: 0.5 },
  busLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  busIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  busIconText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  busNumber: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  busDetail: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  featureRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  featureBadge: { backgroundColor: '#374151', color: '#9ca3af', fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  busRight: { alignItems: 'flex-end' },
  speedDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  speedText: { color: '#d1d5db', fontSize: 14, fontWeight: '600' },
  gpsTime: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  inactiveText: { color: '#6b7280', fontSize: 14 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 32, fontSize: 16 },
});
