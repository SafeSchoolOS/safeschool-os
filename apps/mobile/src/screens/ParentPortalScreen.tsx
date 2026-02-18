import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function ParentPortalScreen({ navigation }: any) {
  const { user } = useAuth();
  const siteId = user?.siteIds[0];

  // Fetch children's bus status
  const { data: students, isLoading: studentsLoading, refetch: refetchStudents } = useQuery({
    queryKey: ['parent-students', siteId],
    queryFn: () => api.get(`/transportation/my-students`),
    refetchInterval: 30000,
  });

  // Fetch active alerts for the site
  const { data: alerts } = useQuery({
    queryKey: ['parent-alerts', siteId],
    queryFn: () => api.get(`/alerts?siteId=${siteId}`),
    refetchInterval: 10000,
  });

  const activeAlerts = (alerts || []).filter((a: any) => !['RESOLVED', 'CANCELLED'].includes(a.status));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>&larr; Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Parent Portal</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Active Alert Banner */}
      {activeAlerts.length > 0 && (
        <View style={styles.alertBanner}>
          <Text style={styles.alertBannerText}>
            {activeAlerts[0].level === 'LOCKDOWN' ? 'LOCKDOWN IN EFFECT' :
             activeAlerts[0].level === 'ACTIVE_THREAT' ? 'EMERGENCY ALERT' :
             'ACTIVE ALERT'}
          </Text>
          <Text style={styles.alertBannerSub}>
            {activeAlerts[0].message || activeAlerts[0].level} - {activeAlerts[0].buildingName}
          </Text>
        </View>
      )}

      {/* School Status */}
      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: activeAlerts.length > 0 ? '#dc2626' : '#16a34a' }]} />
        <Text style={styles.statusText}>
          {activeAlerts.length > 0 ? `${activeAlerts.length} Active Alert(s)` : 'All Clear - School is Safe'}
        </Text>
      </View>

      {/* Children's Bus Status */}
      <Text style={styles.sectionTitle}>My Children</Text>
      <FlatList
        data={students || []}
        keyExtractor={(item: any) => item.id || item.cardId}
        refreshControl={<RefreshControl refreshing={studentsLoading} onRefresh={refetchStudents} tintColor="#fff" />}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.studentCard}>
            <View style={styles.studentInfo}>
              <Text style={styles.studentName}>{item.studentName}</Text>
              <Text style={styles.studentGrade}>Grade {item.grade}</Text>
            </View>
            <View style={styles.busInfo}>
              {item.lastEvent ? (
                <>
                  <Text style={[styles.busStatus, {
                    color: item.lastEvent.scanType === 'BOARD' ? '#22c55e' : '#3b82f6'
                  }]}>
                    {item.lastEvent.scanType === 'BOARD' ? 'On Bus' : 'Off Bus'}
                  </Text>
                  <Text style={styles.busNumber}>Bus #{item.busNumber}</Text>
                  <Text style={styles.busTime}>
                    {new Date(item.lastEvent.scannedAt).toLocaleTimeString()}
                  </Text>
                </>
              ) : (
                <Text style={styles.busStatus}>No scan today</Text>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No students linked to your account</Text>
            <Text style={styles.emptySubtext}>Contact the school office to link your children</Text>
          </View>
        }
      />

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickBtn}>
          <Text style={styles.quickBtnText}>Report Absence</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn}>
          <Text style={styles.quickBtnText}>Early Pickup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 56, backgroundColor: '#1f2937' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  back: { color: '#60a5fa', fontSize: 16 },
  alertBanner: { backgroundColor: '#991b1b', padding: 16, alignItems: 'center' },
  alertBannerText: { color: '#fff', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  alertBannerSub: { color: '#fecaca', fontSize: 14, marginTop: 4 },
  statusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', margin: 16, padding: 16, borderRadius: 12, gap: 12 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { color: '#d1d5db', fontSize: 16, fontWeight: '600' },
  sectionTitle: { color: '#9ca3af', fontSize: 14, fontWeight: '600', marginHorizontal: 16, marginTop: 8, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  studentCard: { backgroundColor: '#1f2937', marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  studentInfo: { flex: 1 },
  studentName: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  studentGrade: { color: '#9ca3af', fontSize: 14, marginTop: 2 },
  busInfo: { alignItems: 'flex-end' },
  busStatus: { color: '#9ca3af', fontSize: 16, fontWeight: '600' },
  busNumber: { color: '#6b7280', fontSize: 13, marginTop: 2 },
  busTime: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  emptyCard: { backgroundColor: '#1f2937', margin: 16, padding: 24, borderRadius: 12, alignItems: 'center' },
  emptyText: { color: '#9ca3af', fontSize: 16 },
  emptySubtext: { color: '#6b7280', fontSize: 14, marginTop: 4 },
  quickActions: { flexDirection: 'row', gap: 12, margin: 16 },
  quickBtn: { flex: 1, backgroundColor: '#1f2937', padding: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#374151' },
  quickBtnText: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
});
