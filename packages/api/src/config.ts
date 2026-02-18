import type { AccessControlAdapter } from '@safeschool/core';

interface AppConfig {
  auth: {
    provider: 'dev' | 'clerk';
    clerkSecretKey?: string;
    clerkPublishableKey?: string;
    clerkWebhookSecret?: string;
  };
  dispatch: {
    adapter: string;
    primary?: string;
    secondary?: string;
    cellularEnabled: boolean;
    cellularDevice?: string;
    timeoutMs: number;
  };
  accessControl: {
    adapter: string;
    apiUrl?: string;
    apiKey?: string;
    username?: string;
    password?: string;
    options?: Record<string, unknown>;
  };
  notifications: {
    adapter: string;
    twilio: {
      accountSid?: string;
      authToken?: string;
      fromNumber?: string;
    };
    sendgrid: {
      apiKey?: string;
      fromEmail?: string;
    };
    fcm: {
      projectId?: string;
      credentials?: string;
    };
    pa: {
      endpoint?: string;
      apiKey?: string;
    };
  };
  transport: {
    enabled: boolean;
    geofenceRadiusMeters: number;
    delayThresholdMinutes: number;
    missedBusGraceMinutes: number;
  };
  visitorMgmt: {
    screeningAdapter: string;
  };
  cameras: {
    adapter: string;
    onvifDiscovery: boolean;
    genetecVmsUrl?: string;
    milestoneVmsUrl?: string;
    avigilonUrl?: string;
    username?: string;
    password?: string;
    clientId?: string;
    clientSecret?: string;
  };
  threatIntel: {
    adapter: string;
    zeroEyesApiUrl?: string;
    zeroEyesApiKey?: string;
    zeroEyesWebhookSecret?: string;
  };
  panicDevices: {
    centegixWebhookSecret: string;
    raveApiKey: string;
  };
  weaponsDetection: {
    evolvApiKey: string;
    evolvWebhookSecret: string;
    evolvApiUrl: string;
    ceiaWebhookSecret: string;
    xtractOneApiKey: string;
    xtractOneWebhookSecret: string;
  };
  socialMedia: {
    adapter: string;
    barkApiUrl: string;
    barkApiKey: string;
    barkWebhookSecret: string;
    gaggleApiUrl: string;
    gaggleApiKey: string;
    gaggleWebhookSecret: string;
    securlyApiUrl: string;
    securlyApiKey: string;
    securlyWebhookSecret: string;
    navigate360ApiUrl: string;
    navigate360ApiKey: string;
    navigate360WebhookSecret: string;
    pollingIntervalSeconds: number;
  };
}

export function getConfig(): AppConfig {
  return {
    auth: {
      provider: (process.env.AUTH_PROVIDER as 'dev' | 'clerk') || 'dev',
      clerkSecretKey: process.env.CLERK_SECRET_KEY,
      clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      clerkWebhookSecret: process.env.CLERK_WEBHOOK_SECRET,
    },
    dispatch: {
      adapter: process.env.DISPATCH_ADAPTER || 'console',
      primary: process.env.DISPATCH_PRIMARY,
      secondary: process.env.DISPATCH_SECONDARY,
      cellularEnabled: process.env.CELLULAR_FAILOVER_ENABLED === 'true',
      cellularDevice: process.env.CELLULAR_MODEM_DEVICE,
      timeoutMs: parseInt(process.env.DISPATCH_TIMEOUT_MS || '10000', 10),
    },
    accessControl: {
      adapter: process.env.ACCESS_CONTROL_ADAPTER || 'mock',
      apiUrl: process.env.SICUNET_API_URL || process.env.GENETEC_API_URL || process.env.BRIVO_API_URL || process.env.VERKADA_API_URL,
      apiKey: process.env.SICUNET_API_KEY || process.env.GENETEC_API_KEY || process.env.BRIVO_API_KEY || process.env.VERKADA_API_KEY,
      username: process.env.AC_USERNAME,
      password: process.env.AC_PASSWORD,
    },
    notifications: {
      adapter: process.env.NOTIFICATION_ADAPTER || 'console',
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        fromNumber: process.env.TWILIO_FROM_NUMBER,
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: process.env.SENDGRID_FROM_EMAIL,
      },
      fcm: {
        projectId: process.env.FCM_PROJECT_ID,
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
      pa: {
        endpoint: process.env.PA_INTERCOM_ENDPOINT,
        apiKey: process.env.PA_INTERCOM_API_KEY,
      },
    },
    transport: {
      enabled: process.env.TRANSPORT_TRACKING_ENABLED === 'true',
      geofenceRadiusMeters: parseInt(process.env.GEOFENCE_RADIUS_METERS || '200', 10),
      delayThresholdMinutes: parseInt(process.env.DELAY_THRESHOLD_MINUTES || '5', 10),
      missedBusGraceMinutes: parseInt(process.env.MISSED_BUS_GRACE_MINUTES || '10', 10),
    },
    visitorMgmt: {
      screeningAdapter: process.env.VISITOR_SCREENING_ADAPTER || 'console',
    },
    cameras: {
      adapter: process.env.CAMERA_ADAPTER || 'none',
      onvifDiscovery: process.env.ONVIF_DISCOVERY_ENABLED === 'true',
      genetecVmsUrl: process.env.GENETEC_VMS_URL,
      milestoneVmsUrl: process.env.MILESTONE_VMS_URL,
      avigilonUrl: process.env.AVIGILON_URL,
      username: process.env.CAMERA_USERNAME,
      password: process.env.CAMERA_PASSWORD,
      clientId: process.env.CAMERA_CLIENT_ID,
      clientSecret: process.env.CAMERA_CLIENT_SECRET,
    },
    threatIntel: {
      adapter: process.env.THREAT_INTEL_ADAPTER || 'none',
      zeroEyesApiUrl: process.env.ZEROEYES_API_URL,
      zeroEyesApiKey: process.env.ZEROEYES_API_KEY,
      zeroEyesWebhookSecret: process.env.ZEROEYES_WEBHOOK_SECRET,
    },
    panicDevices: {
      centegixWebhookSecret: process.env.CENTEGIX_WEBHOOK_SECRET || '',
      raveApiKey: process.env.RAVE_API_KEY || '',
    },
    weaponsDetection: {
      evolvApiKey: process.env.EVOLV_API_KEY || '',
      evolvWebhookSecret: process.env.EVOLV_WEBHOOK_SECRET || '',
      evolvApiUrl: process.env.EVOLV_API_URL || 'https://api.evolvtechnology.com',
      ceiaWebhookSecret: process.env.CEIA_WEBHOOK_SECRET || '',
      xtractOneApiKey: process.env.XTRACT_ONE_API_KEY || '',
      xtractOneWebhookSecret: process.env.XTRACT_ONE_WEBHOOK_SECRET || '',
    },
    socialMedia: {
      adapter: process.env.SOCIAL_MEDIA_ADAPTER || 'console',
      barkApiUrl: process.env.BARK_API_URL || '',
      barkApiKey: process.env.BARK_API_KEY || '',
      barkWebhookSecret: process.env.BARK_WEBHOOK_SECRET || '',
      gaggleApiUrl: process.env.GAGGLE_API_URL || '',
      gaggleApiKey: process.env.GAGGLE_API_KEY || '',
      gaggleWebhookSecret: process.env.GAGGLE_WEBHOOK_SECRET || '',
      securlyApiUrl: process.env.SECURLY_API_URL || '',
      securlyApiKey: process.env.SECURLY_API_KEY || '',
      securlyWebhookSecret: process.env.SECURLY_WEBHOOK_SECRET || '',
      navigate360ApiUrl: process.env.NAVIGATE360_API_URL || '',
      navigate360ApiKey: process.env.NAVIGATE360_API_KEY || '',
      navigate360WebhookSecret: process.env.NAVIGATE360_WEBHOOK_SECRET || '',
      pollingIntervalSeconds: parseInt(process.env.SOCIAL_MEDIA_POLL_INTERVAL || '300', 10),
    },
  };
}
