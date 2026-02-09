import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const LEVEL_COLORS: Record<string, string> = {
  ACTIVE_THREAT: '#dc2626',
  LOCKDOWN: '#ea580c',
  FIRE: '#d97706',
  MEDICAL: '#2563eb',
  WEATHER: '#7c3aed',
  ALL_CLEAR: '#16a34a',
};

const STATUS_BADGES: Record<string, { bg: string; text: string }> = {
  TRIGGERED: { bg: '#dc2626', text: 'ACTIVE' },
  ACKNOWLEDGED: { bg: '#d97706', text: 'ACK' },
  DISPATCHED: { bg: '#2563eb', text: 'DISPATCHED' },
  RESOLVED: { bg: '#16a34a', text: 'RESOLVED' },
  CANCELLED: { bg: '#6b7280', text: 'CANCELLED' },
};

export function AlertFeed({ navigation }: any) {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];

  const { data: alerts, isLoading, refetch } = useQuery({
    queryKey: ['alerts', siteId],
    queryFn: () => api.get(`/alerts?limit=50${siteId ? `&siteId=${siteId}` : ''}`),
    refetchInterval: 5000,
  });

  const getLevelColor = (level: string) => LEVEL_COLORS[level] || '#6b7280';

  const getBadge = (status: string) => STATUS_BADGES[status] || { bg: '#6b7280', text: status };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const activeCount = (alerts || []).filter(
    (a: any) => a.status === 'TRIGGERED' || a.status === 'ACKNOWLEDGED'
  ).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Alerts</Text>
        {activeCount > 0 && (
          <View style={styles.activeCountBadge}>
            <Text style={styles.activeCountText}>{activeCount} Active</Text>
          </View>
        )}
      </View>

      {/* Alert List */}
      <FlatList
        data={alerts || []}
        keyExtractor={(item: any) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor="#9ca3af"
            colors={['#dc2626']}
          />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }: { item: any }) => {
          const levelColor = getLevelColor(item.level);
          const badge = getBadge(item.status);
          const isActive = item.status === 'TRIGGERED' || item.status === 'ACKNOWLEDGED';

          return (
            <TouchableOpacity
              style={[
                styles.alertCard,
                { borderLeftColor: levelColor },
                isActive && styles.alertCardActive,
              ]}
              onPress={() => navigation.navigate('AlertDetail', { alert: item })}
              activeOpacity={0.7}
            >
              <View style={styles.alertTop}>
                <View style={styles.alertLevelRow}>
                  <View style={[styles.levelDot, { backgroundColor: levelColor }]} />
                  <Text style={[styles.alertLevel, { color: levelColor }]}>
                    {item.level.replace('_', ' ')}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.statusText}>{badge.text}</Text>
                </View>
              </View>

              {item.message && (
                <Text style={styles.alertMessage} numberOfLines={2}>
                  {item.message}
                </Text>
              )}

              <View style={styles.alertBottom}>
                <Text style={styles.alertLocation}>
                  {item.buildingName}
                  {item.roomName ? ` - ${item.roomName}` : ''}
                </Text>
                <Text style={styles.alertTime}>{formatTime(item.triggeredAt)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No Alerts</Text>
            <Text style={styles.emptySubtitle}>
              All clear. Pull down to refresh.
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 56,
    backgroundColor: '#1f2937',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  activeCountBadge: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeCountText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  alertCard: {
    backgroundColor: '#1f2937',
    marginBottom: 10,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  alertCardActive: {
    backgroundColor: '#1c1917',
    borderWidth: 1,
    borderColor: '#374151',
  },
  alertTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  levelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  alertLevel: {
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  alertMessage: {
    color: '#d1d5db',
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 20,
  },
  alertBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertLocation: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
  },
  alertTime: {
    color: '#6b7280',
    fontSize: 12,
    marginLeft: 8,
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
