import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { NetworkProvider, useNetwork } from './src/hooks/NetworkContext';
import { OfflineBanner } from './src/components/OfflineBanner';
import { LoginScreen } from './src/screens/LoginScreen';
import { AlertFeed } from './src/screens/AlertFeed';
import { AlertDetailScreen } from './src/screens/AlertDetailScreen';
import { PanicScreen } from './src/screens/PanicScreen';
import { BusTracker } from './src/screens/BusTracker';
import { SettingsScreen } from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const queryClient = new QueryClient();

// Simple text-based tab icons (no native module dependencies)
function TabIcon({ label, color }: { label: string; color: string }) {
  return <Text style={{ color, fontSize: 20 }}>{label}</Text>;
}

function AlertsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#1f2937' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen
        name="AlertFeed"
        component={AlertFeed}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AlertDetail"
        component={AlertDetailScreen}
        options={{ title: 'Alert Detail' }}
      />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1f2937',
          borderTopColor: '#374151',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarActiveTintColor: '#dc2626',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="AlertsTab"
        component={AlertsStack}
        options={{
          tabBarLabel: 'Alerts',
          tabBarIcon: ({ color }) => <TabIcon label="!" color={color} />,
        }}
      />
      <Tab.Screen
        name="PanicTab"
        component={PanicScreen}
        options={{
          tabBarLabel: 'Panic',
          tabBarIcon: ({ color }) => <TabIcon label="*" color={color} />,
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: 'bold',
            color: '#dc2626',
          },
        }}
      />
      <Tab.Screen
        name="BusTab"
        component={BusTracker}
        options={{
          tabBarLabel: 'Buses',
          tabBarIcon: ({ color }) => <TabIcon label="B" color={color} />,
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon label="G" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { user, loading } = useAuth();
  const { isOnline } = useNetwork();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#dc2626" />
        <Text style={styles.loadingText}>SafeSchool</Text>
      </View>
    );
  }

  return (
    <View style={styles.appContainer}>
      <OfflineBanner isOnline={isOnline} />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </View>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NetworkProvider>
          <NavigationContainer>
            <AppNavigator />
            <StatusBar style="light" />
          </NavigationContainer>
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 18,
    marginTop: 16,
    fontWeight: '600',
  },
});
