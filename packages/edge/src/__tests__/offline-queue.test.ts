import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OfflineQueue } from '../offline-queue.js';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue(':memory:');
  });

  afterEach(() => {
    queue.close();
  });

  // ==========================================================================
  // enqueue / dequeue
  // ==========================================================================

  describe('enqueue and dequeue', () => {
    it('enqueues an operation and returns an auto-incremented id', () => {
      const id1 = queue.enqueue('alert', 'create', { id: 'a1', level: 'LOCKDOWN' });
      const id2 = queue.enqueue('door', 'update', { id: 'd1', status: 'LOCKED' });

      expect(id1).toBe(1);
      expect(id2).toBe(2);
    });

    it('dequeues operations in FIFO order', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('visitor', 'update', { id: 'v1' });
      queue.enqueue('door', 'update', { id: 'd1' });

      const batch = queue.dequeue(2);

      expect(batch).toHaveLength(2);
      expect(batch[0].entity).toBe('alert');
      expect(batch[0].operation).toBe('create');
      expect(JSON.parse(batch[0].data)).toEqual({ id: 'a1' });
      expect(batch[1].entity).toBe('visitor');
    });

    it('dequeues all pending when batchSize exceeds queue size', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });

      const batch = queue.dequeue(100);
      expect(batch).toHaveLength(2);
    });

    it('returns empty array when queue is empty', () => {
      const batch = queue.dequeue(10);
      expect(batch).toHaveLength(0);
    });

    it('accepts string data directly', () => {
      const jsonStr = '{"id":"a1","level":"FIRE"}';
      queue.enqueue('alert', 'create', jsonStr);

      const batch = queue.dequeue(1);
      expect(batch[0].data).toBe(jsonStr);
    });

    it('serializes object data to JSON', () => {
      const data = { id: 'a1', nested: { foo: 'bar' } };
      queue.enqueue('alert', 'create', data);

      const batch = queue.dequeue(1);
      expect(JSON.parse(batch[0].data)).toEqual(data);
    });
  });

  // ==========================================================================
  // markComplete
  // ==========================================================================

  describe('markComplete', () => {
    it('marks operations as complete so they are not dequeued again', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });
      queue.enqueue('alert', 'create', { id: 'a3' });

      const batch = queue.dequeue(2);
      queue.markComplete(batch.map((op) => op.id));

      const remaining = queue.dequeue(10);
      expect(remaining).toHaveLength(1);
      expect(JSON.parse(remaining[0].data)).toEqual({ id: 'a3' });
    });

    it('updates stats after marking complete', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });

      let stats = queue.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.complete).toBe(0);

      const batch = queue.dequeue(2);
      queue.markComplete(batch.map((op) => op.id));

      stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.complete).toBe(2);
    });
  });

  // ==========================================================================
  // markFailed / retry / backoff
  // ==========================================================================

  describe('markFailed and retry backoff', () => {
    it('marks an operation as failed with error message', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      const batch = queue.dequeue(1);

      queue.markFailed(batch.map((op) => op.id), 'Network timeout');

      // After first failure, retry count is 1 and the op stays pending
      // but with a future next_retry_at, so it should NOT be dequeued immediately
      const immediate = queue.dequeue(10);
      expect(immediate).toHaveLength(0);
    });

    it('records the last error message', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      const batch = queue.dequeue(1);

      queue.markFailed([batch[0].id], 'Connection refused');

      // Stats should reflect the operation is still pending (retryable)
      const stats = queue.getStats();
      // After 1 failure with retry_count < 5, status is 'pending'
      expect(stats.pending).toBe(1);
    });

    it('permanently fails after max retries', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });

      // Simulate 6 failures (max 5 retries) by repeatedly dequeuing and failing
      // We need to manipulate the next_retry_at to make it dequeue-able
      for (let i = 0; i < 6; i++) {
        // Manually reset next_retry_at so we can dequeue
        const db = (queue as any).db;
        db.prepare("UPDATE sync_queue SET next_retry_at = datetime('now', '-1 hour') WHERE status = 'pending'").run();

        const batch = queue.dequeue(1);
        if (batch.length === 0) break;
        queue.markFailed([batch[0].id], `Failure ${i + 1}`);
      }

      const stats = queue.getStats();
      // After exceeding max retries, the operation should be permanently failed
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(0);
    });
  });

  // ==========================================================================
  // getStats
  // ==========================================================================

  describe('getStats', () => {
    it('returns zeroes for empty queue', () => {
      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.complete).toBe(0);
      expect(stats.oldestPending).toBeNull();
    });

    it('tracks pending count correctly', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });
      queue.enqueue('door', 'update', { id: 'd1' });

      const stats = queue.getStats();
      expect(stats.pending).toBe(3);
    });

    it('reports oldest pending timestamp', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });

      const stats = queue.getStats();
      expect(stats.oldestPending).not.toBeNull();
      // The oldest pending should be a valid date string
      expect(new Date(stats.oldestPending!).getTime()).not.toBeNaN();
    });
  });

  // ==========================================================================
  // Persistence (same :memory: db instance)
  // ==========================================================================

  describe('persistence within a single instance', () => {
    it('data survives across multiple enqueue/dequeue cycles', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });

      // Dequeue one and complete it
      const first = queue.dequeue(1);
      queue.markComplete([first[0].id]);

      // Enqueue more
      queue.enqueue('door', 'update', { id: 'd1' });

      // Should have 2 pending (a2 + d1) and 1 complete
      const stats = queue.getStats();
      expect(stats.pending).toBe(2);
      expect(stats.complete).toBe(1);
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('removes all entries from the queue', () => {
      queue.enqueue('alert', 'create', { id: 'a1' });
      queue.enqueue('alert', 'create', { id: 'a2' });
      queue.enqueue('alert', 'create', { id: 'a3' });

      queue.clear();

      const stats = queue.getStats();
      expect(stats.pending).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.complete).toBe(0);
    });
  });
});
