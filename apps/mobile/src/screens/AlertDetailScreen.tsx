import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { useUpdateAlertStatus } from '../api/alerts';

interface Props {
  route: { params: { alert: any } };
  navigation: any;
}

export function AlertDetailScreen({ route, navigation }: Props) {
  const { alert } = route.params;
  const updateStatus = useUpdateAlertStatus();

  const handleAction = (status: string, label: string) => {
    Alert.alert(`${label} Alert?`, `This will mark the alert as ${status}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: label,
        onPress: async () => {
          try {
            await updateStatus.mutateAsync({ id: alert.id, status });
            navigation.goBack();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed');
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.level}>{alert.level}</Text>
        <Text style={styles.status}>Status: {alert.status}</Text>
        <Text style={styles.label}>Location</Text>
        <Text style={styles.value}>{alert.buildingName}{alert.roomName ? ` - ${alert.roomName}` : ''}</Text>
        {alert.message && (
          <>
            <Text style={styles.label}>Message</Text>
            <Text style={styles.value}>{alert.message}</Text>
          </>
        )}
        <Text style={styles.label}>Triggered At</Text>
        <Text style={styles.value}>{new Date(alert.triggeredAt).toLocaleString()}</Text>
        {alert.acknowledgedAt && (
          <>
            <Text style={styles.label}>Acknowledged At</Text>
            <Text style={styles.value}>{new Date(alert.acknowledgedAt).toLocaleString()}</Text>
          </>
        )}
      </View>

      {alert.status === 'TRIGGERED' && (
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.actionBtn, styles.ackBtn]} onPress={() => handleAction('ACKNOWLEDGED', 'Acknowledge')}>
            <Text style={styles.actionText}>Acknowledge</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => handleAction('CANCELLED', 'Cancel')}>
            <Text style={styles.actionText}>Cancel Alert</Text>
          </TouchableOpacity>
        </View>
      )}

      {alert.status === 'ACKNOWLEDGED' && (
        <TouchableOpacity style={[styles.actionBtn, styles.resolveBtn, { margin: 16 }]} onPress={() => handleAction('RESOLVED', 'Resolve')}>
          <Text style={styles.actionText}>Mark Resolved</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827' },
  card: { backgroundColor: '#1f2937', margin: 16, padding: 20, borderRadius: 16 },
  level: { color: '#fff', fontSize: 28, fontWeight: 'bold', marginBottom: 8 },
  status: { color: '#9ca3af', fontSize: 16, marginBottom: 16 },
  label: { color: '#6b7280', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 12 },
  value: { color: '#d1d5db', fontSize: 16, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12, margin: 16 },
  actionBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  ackBtn: { backgroundColor: '#d97706' },
  cancelBtn: { backgroundColor: '#6b7280' },
  resolveBtn: { backgroundColor: '#16a34a' },
  actionText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
