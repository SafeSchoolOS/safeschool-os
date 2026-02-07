import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuth } from '../auth/AuthContext';

export function LoginScreen() {
  const { login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email) return;
    try {
      setError('');
      await login(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SafeSchool</Text>
      <Text style={styles.subtitle}>School Safety Platform</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor="#6b7280"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading || !email}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 36, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { color: '#9ca3af', fontSize: 16, textAlign: 'center', marginBottom: 48 },
  form: { gap: 16 },
  input: { backgroundColor: '#1f2937', color: '#fff', padding: 16, borderRadius: 12, fontSize: 18, borderWidth: 1, borderColor: '#374151' },
  error: { color: '#ef4444', textAlign: 'center' },
  button: { backgroundColor: '#dc2626', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
