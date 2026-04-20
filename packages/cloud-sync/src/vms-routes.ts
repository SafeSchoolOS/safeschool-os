// @ts-nocheck
/**
 * VMS Emulator Routes
 *
 * Emulates a Milestone XProtect-style Video Management System for demo mode.
 * Provides camera snapshot (JPEG) and stream (MJPEG) endpoints that generate
 * synthetic security camera frames with timestamps and camera labels.
 *
 * Routes:
 *   GET /vms/cameras/:cameraId/snapshot — Single JPEG frame
 *   GET /vms/cameras/:cameraId/stream  — MJPEG stream (continuous)
 *   GET /vms/cameras                   — List available cameras
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createLogger } from '@edgeruntime/core';

const log = createLogger('cloud-sync:vms');

// Camera definitions keyed by ID — shared with PAC emulator
const VMS_CAMERAS: Record<string, { name: string; location: string; color: string }> = {
  // SafeSchool
  'cam-main-entrance': { name: 'Main Entrance', location: 'Front Door', color: '#f59e0b' },
  'cam-front-office': { name: 'Front Office', location: 'Admin Building', color: '#f59e0b' },
  'cam-hallway-a': { name: 'Hallway A', location: '1st Floor', color: '#f59e0b' },
  'cam-hallway-b': { name: 'Hallway B', location: '2nd Floor', color: '#f59e0b' },
  'cam-cafeteria': { name: 'Cafeteria', location: 'Main Campus', color: '#f59e0b' },
  'cam-gymnasium': { name: 'Gymnasium', location: 'Athletic Wing', color: '#f59e0b' },
  'cam-parking-lot': { name: 'Parking Lot', location: 'Exterior', color: '#f59e0b' },
  'cam-playground': { name: 'Playground', location: 'Exterior', color: '#f59e0b' },
  'cam-bus-loop': { name: 'Bus Loop', location: 'Exterior', color: '#f59e0b' },
  // SafeSchool
  'cam-lobby': { name: 'Main Lobby', location: 'Lobby', color: '#3b82f6' },
  'cam-server-room': { name: 'Server Room', location: 'IT', color: '#3b82f6' },
  'cam-parking-garage': { name: 'Parking Garage', location: 'L1', color: '#3b82f6' },
  'cam-loading-dock': { name: 'Loading Dock', location: 'Rear', color: '#3b82f6' },
  'cam-elevator-1': { name: 'Elevator 1', location: 'Floor 1', color: '#3b82f6' },
  'cam-stairwell-a': { name: 'Stairwell A', location: 'Building A', color: '#3b82f6' },
  // SafeSchool
  'cam-gsoc-perimeter-n': { name: 'Perimeter North', location: 'North Gate', color: '#00ff88' },
  'cam-gsoc-perimeter-s': { name: 'Perimeter South', location: 'South Gate', color: '#00ff88' },
  'cam-gsoc-lobby': { name: 'GSOC Lobby', location: 'Main Building', color: '#00ff88' },
  'cam-gsoc-command': { name: 'Command Center', location: 'GSOC Floor', color: '#00ff88' },
  'cam-gsoc-safeschool': { name: 'Data Center', location: 'DC1', color: '#00ff88' },
  'cam-gsoc-rooftop': { name: 'Rooftop', location: 'Roof', color: '#00ff88' },
  'cam-gsoc-parking': { name: 'Executive Parking', location: 'VIP Lot', color: '#00ff88' },
  'cam-gsoc-warehouse': { name: 'Warehouse', location: 'Warehouse', color: '#00ff88' },
  // LDS Church MTC
  'cam-main-entry': { name: 'Main Entry Screening', location: 'MTC Lobby', color: '#1e3a5f' },
  'cam-chapel-foyer': { name: 'Chapel Foyer', location: 'Stake Center', color: '#1e3a5f' },
  'cam-parking-l1': { name: 'Parking Level 1', location: 'Parking', color: '#1e3a5f' },
  'cam-parking-l3': { name: 'Parking Level 3', location: 'Parking', color: '#1e3a5f' },
  'cam-perimeter-east': { name: 'Perimeter East Gate', location: 'East', color: '#1e3a5f' },
  'cam-perimeter-west': { name: 'Perimeter West Gate', location: 'West', color: '#1e3a5f' },
  'cam-mtc-cafeteria': { name: 'Cafeteria', location: 'Commons', color: '#1e3a5f' },
  'cam-mtc-gymnasium': { name: 'Gymnasium', location: 'Recreation', color: '#1e3a5f' },
  'cam-temple-annex': { name: 'Temple Annex', location: 'Exterior', color: '#1e3a5f' },
};

/**
 * Generate a synthetic security camera frame as an SVG, then convert to a
 * simple JPEG-compatible image. Since we can't easily generate real JPEG
 * in pure Node without native deps, we serve SVG with image/svg+xml and
 * the dashboard img tag will render it fine.
 */
function generateCameraFrame(cameraId: string): { svg: string; contentType: string } {
  const cam = VMS_CAMERAS[cameraId] || { name: cameraId, location: 'Unknown', color: '#888' };
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
  const noise = Math.random();

  // Subtle animated noise effect via random rectangles
  let noiseRects = '';
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(Math.random() * 640);
    const y = Math.floor(Math.random() * 480);
    const w = Math.floor(Math.random() * 30) + 5;
    const h = Math.floor(Math.random() * 4) + 1;
    const opacity = (Math.random() * 0.08).toFixed(3);
    noiseRects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" opacity="${opacity}"/>`;
  }

  // Simulated motion detection zones
  const motionX = 100 + Math.floor(Math.random() * 400);
  const motionY = 100 + Math.floor(Math.random() * 250);
  const hasMotion = noise > 0.6;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1a1a2e"/>
      <stop offset="100%" stop-color="#0f0f1a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#bg)"/>
  ${noiseRects}
  <!-- Grid overlay -->
  <line x1="0" y1="240" x2="640" y2="240" stroke="white" stroke-opacity="0.05" stroke-width="1"/>
  <line x1="320" y1="0" x2="320" y2="480" stroke="white" stroke-opacity="0.05" stroke-width="1"/>
  <!-- Simulated scene elements -->
  <rect x="50" y="380" width="540" height="100" fill="#222" opacity="0.5" rx="2"/>
  <rect x="280" y="200" width="80" height="180" fill="#333" opacity="0.4" rx="2"/>
  <rect x="290" y="220" width="25" height="40" fill="#444" opacity="0.3"/>
  <rect x="325" y="220" width="25" height="40" fill="#444" opacity="0.3"/>
  ${hasMotion ? `<rect x="${motionX}" y="${motionY}" width="60" height="80" fill="none" stroke="${cam.color}" stroke-width="2" stroke-dasharray="4,4" opacity="0.8"/>
  <text x="${motionX}" y="${motionY - 5}" fill="${cam.color}" font-size="10" font-family="monospace" opacity="0.9">MOTION</text>` : ''}
  ${/* Weapon detection overlay — simulated Omnilert AI detection on entry cameras */
  (cameraId.includes('entry') || cameraId.includes('foyer') || cameraId.includes('main-entrance')) && noise > 0.92
    ? `<rect x="220" y="160" width="70" height="120" fill="none" stroke="#ef4444" stroke-width="3" opacity="0.95"/>
       <rect x="220" y="145" width="160" height="18" fill="#ef4444" rx="2"/>
       <text x="225" y="158" fill="white" font-size="11" font-family="monospace" font-weight="bold">WEAPON DETECTED 94%</text>
       <rect x="220" y="282" width="70" height="16" fill="rgba(239,68,68,0.8)" rx="2"/>
       <text x="225" y="294" fill="white" font-size="9" font-family="monospace">Omnilert AI</text>
       <line x1="0" y1="35" x2="640" y2="35" stroke="#ef4444" stroke-width="2" opacity="0.8"/>
       <rect x="400" y="5" width="140" height="24" fill="#ef4444" rx="3"/>
       <text x="410" y="22" fill="white" font-size="11" font-family="monospace" font-weight="bold">⚠ THREAT ALERT</text>`
    : ''}
  <!-- Camera info overlay -->
  <rect x="0" y="0" width="640" height="32" fill="black" opacity="0.7"/>
  <text x="10" y="22" fill="${cam.color}" font-size="14" font-family="monospace" font-weight="bold">${cam.name}</text>
  <text x="630" y="22" fill="white" font-size="12" font-family="monospace" text-anchor="end" opacity="0.8">${ts}</text>
  <!-- Bottom bar -->
  <rect x="0" y="452" width="640" height="28" fill="black" opacity="0.7"/>
  <circle cx="16" cy="466" r="5" fill="#22c55e"/>
  <text x="28" y="470" fill="white" font-size="11" font-family="monospace" opacity="0.8">REC</text>
  <text x="70" y="470" fill="white" font-size="11" font-family="monospace" opacity="0.6">${cam.location}</text>
  <text x="630" y="470" fill="white" font-size="11" font-family="monospace" text-anchor="end" opacity="0.6">640x480 30fps</text>
</svg>`;

  return { svg, contentType: 'image/svg+xml' };
}

export interface VmsRoutesOptions {}

export async function vmsRoutes(fastify: FastifyInstance, _opts: VmsRoutesOptions) {
  // GET /vms/cameras — list available cameras
  fastify.get('/vms/cameras', async (_request: FastifyRequest, reply: FastifyReply) => {
    const cameras = Object.entries(VMS_CAMERAS).map(([id, cam]) => ({
      id,
      name: cam.name,
      location: cam.location,
      status: 'online',
      snapshotUrl: `/api/v1/vms/cameras/${id}/snapshot`,
      streamUrl: `/api/v1/vms/cameras/${id}/stream`,
    }));
    return reply.send({ cameras, total: cameras.length });
  });

  // GET /vms/cameras/:cameraId/snapshot — single frame (accepts any camera ID)
  fastify.get('/vms/cameras/:cameraId/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const { cameraId } = request.params as { cameraId: string };
    const frame = generateCameraFrame(cameraId);
    return reply
      .header('Cache-Control', 'no-cache, no-store, must-revalidate')
      .header('Pragma', 'no-cache')
      .type(frame.contentType)
      .send(frame.svg);
  });

  // GET /vms/cameras/:cameraId/stream — MJPEG-style stream using SVG frames
  // Uses multipart/x-mixed-replace to push new frames (accepts any camera ID)
  fastify.get('/vms/cameras/:cameraId/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const { cameraId } = request.params as { cameraId: string };

    const boundary = '---cameraboundary';
    reply.raw.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const sendFrame = () => {
      if (reply.raw.destroyed) return;
      const frame = generateCameraFrame(cameraId);
      const body = frame.svg;
      reply.raw.write(
        `--${boundary}\r\nContent-Type: image/svg+xml\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n`
      );
    };

    // Send frames at ~2fps (lightweight for demo)
    sendFrame();
    const interval = setInterval(sendFrame, 500);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  // GET /vms/cameras/:cameraId/clip — simulated video clip with weapon detection overlay
  // Returns an SVG frame that always shows the detection (for incident detail views)
  fastify.get('/vms/cameras/:cameraId/clip', async (request: FastifyRequest, reply: FastifyReply) => {
    const { cameraId } = request.params as { cameraId: string };
    const cam = VMS_CAMERAS[cameraId] || { name: cameraId, location: 'Unknown', color: '#888' };
    const now = new Date();
    const ts = now.toISOString().replace('T', ' ').replace(/\.\d+Z/, '');
    const confidence = 85 + Math.floor(Math.random() * 13); // 85-97%

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a1a2e"/>
          <stop offset="100%" stop-color="#0f0f1a"/>
        </linearGradient>
      </defs>
      <rect width="640" height="480" fill="url(#bg)"/>
      <!-- Scene elements -->
      <rect x="50" y="380" width="540" height="100" fill="#222" opacity="0.5" rx="2"/>
      <rect x="280" y="200" width="80" height="180" fill="#333" opacity="0.4" rx="2"/>
      <rect x="150" y="250" width="45" height="60" fill="#2a2a3e" opacity="0.5"/>
      <rect x="440" y="270" width="35" height="50" fill="#2a2a3e" opacity="0.4"/>
      <!-- Person silhouette with weapon -->
      <rect x="245" y="180" width="60" height="130" fill="#2a2a40" opacity="0.6" rx="3"/>
      <circle cx="275" cy="170" r="15" fill="#333" opacity="0.5"/>
      <line x1="305" y1="230" x2="340" y2="260" stroke="#444" stroke-width="4" opacity="0.5"/>
      <!-- WEAPON DETECTION BOX -->
      <rect x="230" y="155" width="80" height="165" fill="none" stroke="#ef4444" stroke-width="3"/>
      <rect x="310" y="220" width="45" height="50" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="4,2"/>
      <!-- Detection labels -->
      <rect x="230" y="138" width="190" height="20" fill="#ef4444" rx="3"/>
      <text x="236" y="153" fill="white" font-size="12" font-family="monospace" font-weight="bold">⚠ WEAPON DETECTED ${confidence}%</text>
      <rect x="310" y="272" width="80" height="14" fill="rgba(239,68,68,0.85)" rx="2"/>
      <text x="314" y="283" fill="white" font-size="9" font-family="monospace">HANDGUN</text>
      <!-- Omnilert branding -->
      <rect x="0" y="35" width="640" height="2" fill="#ef4444"/>
      <rect x="10" y="42" width="120" height="18" fill="rgba(239,68,68,0.15)" stroke="#ef4444" stroke-width="1" rx="3"/>
      <text x="16" y="55" fill="#ef4444" font-size="10" font-family="monospace" font-weight="bold">Omnilert AI</text>
      <!-- Verification status -->
      <rect x="480" y="42" width="150" height="18" fill="rgba(245,158,11,0.15)" stroke="#f59e0b" stroke-width="1" rx="3"/>
      <text x="486" y="55" fill="#f59e0b" font-size="10" font-family="monospace">VERIFYING...</text>
      <!-- Camera info -->
      <rect x="0" y="0" width="640" height="32" fill="black" opacity="0.7"/>
      <text x="10" y="22" fill="#ef4444" font-size="14" font-family="monospace" font-weight="bold">${cam.name}</text>
      <text x="630" y="22" fill="white" font-size="12" font-family="monospace" text-anchor="end" opacity="0.8">${ts}</text>
      <!-- Bottom bar -->
      <rect x="0" y="452" width="640" height="28" fill="black" opacity="0.7"/>
      <circle cx="16" cy="466" r="5" fill="#ef4444"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></circle>
      <text x="28" y="470" fill="#ef4444" font-size="11" font-family="monospace" font-weight="bold">● REC — ALERT</text>
      <text x="630" y="470" fill="white" font-size="11" font-family="monospace" text-anchor="end" opacity="0.6">${cam.location}</text>
      <!-- Playback controls -->
      <rect x="200" y="420" width="240" height="24" fill="rgba(0,0,0,0.6)" rx="4"/>
      <text x="215" y="436" fill="white" font-size="10" font-family="monospace" opacity="0.7">▶ 00:03 / 00:10  ━━━━━●━━━ 🔊</text>
    </svg>`;

    return reply
      .header('Cache-Control', 'no-cache')
      .type('image/svg+xml')
      .send(svg);
  });

  log.info({ cameras: Object.keys(VMS_CAMERAS).length }, 'VMS emulator routes registered');
}
