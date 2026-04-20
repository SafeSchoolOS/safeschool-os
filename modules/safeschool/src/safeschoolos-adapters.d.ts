// Ambient module declarations for @safeschoolos/adapters subpaths.
//
// The @safeschoolos/adapters package is an optionalDependency. The runtime
// handles its absence via dynamic-import try/catch (see tryLoadAdapters in
// src/index.ts). These declarations let TypeScript compile without the
// package installed — at runtime, imports either resolve to the real
// package or trigger the graceful fallback path.

declare module '@safeschoolos/adapters/access-control' {
  export const SicunetAdapter: any;
  export const createAdapter: any;
  export type AccessControlAdapter = any;
  export type CredentialManagementAdapter = any;
}

declare module '@safeschoolos/adapters/cameras' {
  export const MilestoneAdapter: any;
  export const createCameraAdapter: any;
  export type CameraAdapter = any;
  export type CameraConfig = any;
}

declare module '@safeschoolos/adapters/dispatch' {
  export const createDispatchAdapter: any;
  export const DispatchChain: any;
  export type DispatchAdapter = any;
}

declare module '@safeschoolos/adapters/notifications' {
  export const NotificationRouter: any;
}

declare module '@safeschoolos/adapters/badge-printing' {
  export const createBadgePrinter: any;
  export type BadgePrinterAdapter = any;
}

declare module '@safeschoolos/adapters/visitor-mgmt' {
  export const VisitorService: any;
  export const ConsoleScreeningAdapter: any;
}

declare module '@safeschoolos/adapters/weather' {
  export const NWSAdapter: any;
  export type WeatherAdapter = any;
}
