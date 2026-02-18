import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function BusTracker() {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];

  const {
    data: buses,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['buses', siteId],
    queryFn: () => api.get('/transportation/buses'),
    refetchInterval: 10000,
  });

  const {
    data: routes,
  } = useQuery({
    queryKey: ['bus-routes', siteId],
    queryFn: () => api.get('/transportation/routes'),
  });

  const getSpeedColor = (speed: number | null) => {
    if (!speed) return '#6b7280';
    if (speed < 10) return '#22c55e';
    if (speed < 35) return '#eab308';
    return '#ef4444';
  };

  const getRouteForBus = (busId: string) => {
    if (!routes) return null;
    return (routes as any[]).find((r: any) =>
      r.assignments?.some((a: any) => a.busId === busId)
    );
  };

  const formatGpsTime = (dateStr: string | null) => {
    if (!dateStr) return 'No GPS data';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return date.toLocaleTimeString();
  };

  const activeBuses = (buses || []).filter((b: any) => b.isActive);
  const inactiveBuses = (buses || []).filter((b: any) => !b.isActive);
  const totalStudents = (buses || []).reduce(
    (sum: number, b: any) => sum + (b.currentStudentCount || 0),
    0
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bus Tracker</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{activeBuses.length}</Text>
          <Text style={styles.summaryLabel}>Active</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{totalStudents}</Text>
          <Text style={styles.summaryLabel}>Students</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryNum}>{(routes || []).length}</Text>
          <Text style={styles.summaryLabel}>Routes</Text>
        </View>
      </View>

      {/* Bus List */}
      <FlatList
        data={[...activeBuses, ...inactiveBuses]}
        keyExtractor={(item: any) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor="#9ca3af"
            colors={['#3b82f6']}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }: { item: any }) => {
          const route = getRouteForBus(item.id);
          return (
            <View style={[styles.busCard, !item.isActive && styles.busInactive]}>
              <View style={styles.busTopRow}>
                {/* Bus Icon */}
                <View
                  style={[
                    styles.busIcon,
                    { backgroundColor: item.isActive ? '#1d4ed8' : '#374151' },
                  ]}
                >
                  <Text style={styles.busIconText}>#{item.busNumber}</Text>
                </View>

                {/* Bus Info */}
                <View style={styles.busInfo}>
                  <Text style={styles.busNumber}>Bus {item.busNumber}</Text>
                  {route && (
                    <Text style={styles.busRoute}>
                      Route: {route.name || route.id}
                    </Text>
                  )}
                </View>

                {/* Status */}
                <View style={styles.busStatusCol}>
                  {item.isActive ? (
                    <>
                      <View style={styles.speedRow}>
                        <View
                          style={[
                            styles.speedDot,
                            { backgroundColor: getSpeedColor(item.currentSpeed) },
                          ]}
                        />
                        <Text style={styles.speedText}>
                          {item.currentSpeed
                            ? `${Math.round(item.currentSpeed)} mph`
                            : 'Stationary'}
                        </Text>
                      </View>
                      <Text style={styles.gpsTime}>
                        GPS: {formatGpsTime(item.lastGpsAt)}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.inactiveLabel}>Inactive</Text>
                  )}
                </View>
              </View>

              {/* Bottom details row */}
              <View style={styles.busBottomRow}>
                <Text style={styles.busDetail}>
                  {item.currentStudentCount || 0} / {item.capacity} students
                </Text>
                <View style={styles.featureRow}>
                  {item.hasRfidReader && (
                    <View style={styles.featureBadge}>
                      <Text style={styles.featureBadgeText}>RFID</Text>
                    </View>
                  )}
                  {item.hasPanicButton && (
                    <View style={styles.featureBadge}>
                      <Text style={styles.featureBadgeText}>PANIC</Text>
                    </View>
                  )}
                  {item.hasCameras && (
                    <View style={styles.featureBadge}>
                      <Text style={styles.featureBadgeText}>CAM</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* GPS coordinates if available */}
              {item.isActive && item.lastLat && item.lastLng && (
                <Text style={styles.gpsCoords}>
                  {item.lastLat.toFixed(4)}, {item.lastLng.toFixed(4)}
                </Text>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Buses</Text>
            <Text style={styles.emptySubtitle}>
              No buses are configured for this site.
            </Text>
          </View>
        }
      />
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
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#1f2937',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryNum: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
  },
  summaryLabel: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  busCard: {
    backgroundColor: '#1f2937',
    marginBottom: 10,
    padding: 14,
    borderRadius: 12,
  },
  busInactive: {
    opacity: 0.5,
  },
  busTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  busIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busIconText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  busInfo: {
    flex: 1,
  },
  busNumber: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  busRoute: {
    color: '#60a5fa',
    fontSize: 13,
    marginTop: 2,
  },
  busStatusCol: {
    alignItems: 'flex-end',
  },
  speedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  speedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speedText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
  gpsTime: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 2,
  },
  inactiveLabel: {
    color: '#6b7280',
    fontSize: 14,
  },
  busBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  busDetail: {
    color: '#9ca3af',
    fontSize: 13,
  },
  featureRow: {
    flexDirection: 'row',
    gap: 4,
  },
  featureBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  featureBadgeText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '600',
  },
  gpsCoords: {
    color: '#4b5563',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'right',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    color: '#6b7280',
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    color: '#4b5563',
    fontSize: 14,
    marginTop: 8,
  },
});
