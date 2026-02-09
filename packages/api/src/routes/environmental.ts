import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export default async function environmentalRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  });

  // GET /api/v1/environmental/sensors — list sensors
  app.get('/sensors', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { type } = request.query as { type?: string };

    const sensors = await app.prisma.environmentalSensor.findMany({
      where: {
        siteId: { in: user.siteIds },
        ...(type && { type: type as any }),
      },
      orderBy: { name: 'asc' },
    });

    return sensors;
  });

  // POST /api/v1/environmental/sensors — register a sensor
  app.post('/sensors', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { id: string; siteIds: string[]; role: string };
    const body = request.body as {
      name: string;
      type: string;
      location: string;
      buildingId?: string;
    };

    if (!body.name || !body.type || !body.location) {
      return reply.status(400).send({ error: 'name, type, and location are required' });
    }

    const sensor = await app.prisma.environmentalSensor.create({
      data: {
        siteId: user.siteIds[0],
        name: body.name,
        type: body.type as any,
        location: body.location,
        buildingId: body.buildingId,
      },
    });

    return reply.status(201).send(sensor);
  });

  // POST /api/v1/environmental/readings — ingest sensor reading
  app.post('/readings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const body = request.body as {
      sensorId: string;
      value: number;
      unit: string;
      isAlert?: boolean;
    };

    if (!body.sensorId || body.value === undefined || !body.unit) {
      return reply.status(400).send({ error: 'sensorId, value, and unit are required' });
    }

    const reading = await app.prisma.environmentalReading.create({
      data: {
        sensorId: body.sensorId,
        value: body.value,
        unit: body.unit,
        isAlert: body.isAlert || false,
        readAt: new Date(),
      },
    });

    // Update sensor's last reading timestamp
    await app.prisma.environmentalSensor.update({
      where: { id: body.sensorId },
      data: { lastReading: new Date() },
    });

    // If alert, create a system alert
    if (body.isAlert) {
      const sensor = await app.prisma.environmentalSensor.findUnique({
        where: { id: body.sensorId },
      });

      if (sensor) {
        try {
          await app.alertQueue.add('environmental-alert', {
            sensorId: sensor.id,
            siteId: sensor.siteId,
            sensorName: sensor.name,
            sensorType: sensor.type,
            value: body.value,
            unit: body.unit,
            location: sensor.location,
          });
        } catch {
          // Non-blocking
        }
      }
    }

    return reply.status(201).send(reading);
  });

  // GET /api/v1/environmental/readings — get readings for a sensor
  app.get('/readings', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };
    const { sensorId, hours } = request.query as { sensorId: string; hours?: string };

    if (!sensorId) {
      return reply.status(400).send({ error: 'sensorId is required' });
    }

    const since = new Date(Date.now() - (parseInt(hours || '24') * 3600 * 1000));

    const readings = await app.prisma.environmentalReading.findMany({
      where: {
        sensorId,
        readAt: { gte: since },
        sensor: { siteId: { in: user.siteIds } },
      },
      orderBy: { readAt: 'desc' },
      take: 500,
    });

    return readings;
  });

  // GET /api/v1/environmental/status — overview of all sensors
  app.get('/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { siteIds: string[] };

    const sensors = await app.prisma.environmentalSensor.findMany({
      where: { siteId: { in: user.siteIds } },
      include: {
        readings: {
          orderBy: { readAt: 'desc' },
          take: 1,
        },
      },
    });

    const alerts = sensors.filter(
      (s) => s.readings.length > 0 && s.readings[0].isAlert,
    );

    return {
      totalSensors: sensors.length,
      onlineSensors: sensors.filter((s) => s.isOnline).length,
      activeAlerts: alerts.length,
      sensors: sensors.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        location: s.location,
        isOnline: s.isOnline,
        lastReading: s.readings[0] || null,
      })),
    };
  });
}
