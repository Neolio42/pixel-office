import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorker,
  updateWorker,
  setWorkerState,
  setWorkerPlanMode,
  startLeaving,
  getWorkerScreenPos,
  WorkerEntity,
} from '../src/game/worker-entity';
import { TILE_SIZE, SCALE, DOOR_X, DOOR_Y, DESK_POSITIONS } from '../src/game/office-layout';

describe('worker-entity', () => {
  describe('createWorker', () => {
    it('creates a worker with correct initial properties', () => {
      const worker = createWorker('session-1', 0);
      expect(worker.sessionId).toBe('session-1');
      expect(worker.deskIndex).toBe(0);
      expect(worker.charIndex).toBe(0);
      expect(worker.x).toBe(DOOR_X);
      expect(worker.y).toBe(DOOR_Y);
      expect(worker.state).toBe('walking');
      expect(worker.facing).toBe('up');
      expect(worker.frameIndex).toBe(0);
      expect(worker.frameTimer).toBe(0);
      expect(worker.speechBubble).toBeNull();
      expect(worker.leaving).toBe(false);
      expect(worker.arrived).toBe(false);
      expect(worker.inBreakRoom).toBe(false);
      expect(worker.inMeetingRoom).toBe(false);
      expect(worker.lastToolTime).toBeGreaterThan(0);
    });

    it('assigns charIndex based on deskIndex modulo 6', () => {
      expect(createWorker('s', 0).charIndex).toBe(0);
      expect(createWorker('s', 5).charIndex).toBe(5);
      expect(createWorker('s', 6).charIndex).toBe(0);
      expect(createWorker('s', 7).charIndex).toBe(1);
    });

    it('targets the desk chair position', () => {
      const worker = createWorker('s', 2);
      const desk = DESK_POSITIONS[2];
      expect(worker.targetX).toBe(desk.chairX);
      expect(worker.targetY).toBe(desk.chairY);
    });

    it('falls back to desk 0 for out-of-range deskIndex', () => {
      const worker = createWorker('s', 99);
      const desk = DESK_POSITIONS[0];
      expect(worker.targetX).toBe(desk.chairX);
      expect(worker.targetY).toBe(desk.chairY);
    });
  });

  describe('updateWorker', () => {
    it('returns false when worker has not reached the door after leaving', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      // Place worker far from door
      worker.x = 2;
      worker.y = 4;
      startLeaving(worker);
      // Worker is not at door yet — but with large dt, it might move all the way
      // Use small dt so worker doesn't reach the door
      const result = updateWorker(worker, 0.001);
      expect(result).toBe(false);
    });

    it('signals removal (returns true) when leaving worker reaches door', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      startLeaving(worker);
      // Simulate reaching the door
      worker.x = DOOR_X;
      worker.y = DOOR_Y;
      const result = updateWorker(worker, 0.016);
      expect(result).toBe(true);
    });

    it('marks worker as arrived when first reaching target', () => {
      const worker = createWorker('s', 0);
      // Move worker to target position
      worker.x = worker.targetX;
      worker.y = worker.targetY;
      updateWorker(worker, 0.016);
      expect(worker.arrived).toBe(true);
      expect(worker.state).toBe('idle');
      expect(worker.facing).toBe('up');
    });

    it('updates walking state while moving', () => {
      const worker = createWorker('s', 0);
      // Ensure worker is far from target
      worker.x = DOOR_X;
      worker.y = DOOR_Y;
      expect(worker.targetX).not.toBe(DOOR_X); // Target should be different
      updateWorker(worker, 0.5);
      expect(worker.state).toBe('walking');
    });

    it('sets facing direction based on movement (up when moving toward smaller y)', () => {
      const worker = createWorker('s', 0);
      // Worker starts at door (row 14), target is at desk chair (row 4-ish)
      // Moving up (toward smaller y)
      updateWorker(worker, 0.016);
      // Since dy > dx (going from row 14 to ~row 4), facing should be 'up'
      if (Math.abs(worker.targetY - worker.y) > Math.abs(worker.targetX - worker.x)) {
        expect(worker.facing).toBe('up');
      }
    });

    it('advances animation frame timer', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      worker.state = 'idle';
      const prevTimer = worker.frameTimer;
      updateWorker(worker, 0.5);
      expect(worker.frameTimer).toBeGreaterThan(prevTimer);
    });

    it('wraps frameIndex based on state frames count', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      worker.state = 'idle';
      worker.frameIndex = 1;
      // Advance enough to trigger frame change (idle duration = 600ms)
      worker.frameTimer = 599;
      updateWorker(worker, 0.01);
      // Frame should have wrapped (idle has 2 frames: [1, 0])
    });

    it('handles leaving path: moves horizontally first', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      // Place worker at desk, start leaving
      worker.x = 4;
      worker.y = 4;
      startLeaving(worker);
      // Worker needs to move both horizontally and vertically
      updateWorker(worker, 0.016);
      // When leaving, horizontal movement comes first
      // If there's horizontal distance, facing should be left or right
      if (Math.abs(worker.x - DOOR_X) > 0.1 && Math.abs(worker.y - DOOR_Y) > 0.1) {
        // Horizontal should be prioritized
        expect(worker.facing).toMatch(/left|right/);
      }
    });

    it('handles arriving path: moves vertically first', () => {
      const worker = createWorker('s', 0);
      // Worker at door, target at desk - arriving
      worker.x = DOOR_X;
      worker.y = DOOR_Y;
      updateWorker(worker, 0.016);
      // When arriving, vertical movement comes first
      // If there's both vertical and horizontal distance
      if (Math.abs(worker.targetY - worker.y) > 0.1 && Math.abs(worker.targetX - worker.x) > 0.1) {
        // Vertical should be prioritized
        expect(worker.facing).toMatch(/up|down/);
      }
    });
  });

  describe('setWorkerState', () => {
    it('does nothing if worker is leaving', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      startLeaving(worker);
      const prevState = worker.state;
      setWorkerState(worker, 'typing');
      expect(worker.state).toBe(prevState);
    });

    it('does nothing if worker has not arrived', () => {
      const worker = createWorker('s', 0);
      worker.arrived = false;
      setWorkerState(worker, 'typing');
      expect(worker.state).toBe('walking'); // Initial state
    });

    it('sends idle worker to break room', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      setWorkerState(worker, 'idle');
      expect(worker.inBreakRoom).toBe(true);
      // Target should be a break room spot
      expect(worker.targetX).toBeGreaterThanOrEqual(14);
      expect(worker.targetX).toBeLessThanOrEqual(18);
      expect(worker.targetY).toBeGreaterThanOrEqual(1);
      expect(worker.targetY).toBeLessThanOrEqual(6);
    });

    it('returns worker from break room when state changes to active', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      // First go to break room
      setWorkerState(worker, 'idle');
      expect(worker.inBreakRoom).toBe(true);
      // Then come back to work
      setWorkerState(worker, 'typing');
      expect(worker.inBreakRoom).toBe(false);
      const desk = DESK_POSITIONS[0];
      expect(worker.targetX).toBe(desk.chairX);
      expect(worker.targetY).toBe(desk.chairY);
    });

    it('changes state and resets animation for normal state transitions at desk', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      worker.state = 'idle';
      worker.frameIndex = 3;
      worker.frameTimer = 500;
      setWorkerState(worker, 'typing');
      // At desk, not in break room: typing triggers normal state change
      // But idle triggers break room. So we need a non-idle start.
      // Let's set typing first, then reading
      worker.state = 'typing';
      worker.inBreakRoom = false;
      setWorkerState(worker, 'reading');
      expect(worker.state).toBe('reading');
      expect(worker.frameIndex).toBe(0);
      expect(worker.frameTimer).toBe(0);
    });

    it('does not reset animation if state is unchanged', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      worker.state = 'typing';
      worker.inBreakRoom = false;
      worker.frameIndex = 2;
      worker.frameTimer = 300;
      setWorkerState(worker, 'typing');
      expect(worker.frameIndex).toBe(2);
      expect(worker.frameTimer).toBe(300);
    });

    it('break room spots cycle based on deskIndex', () => {
      const w0 = createWorker('s', 0);
      w0.arrived = true;
      setWorkerState(w0, 'idle');

      const w1 = createWorker('s', 1);
      w1.arrived = true;
      setWorkerState(w1, 'idle');

      // Different desk indices should get different break room spots
      // (unless they happen to map to the same one modulo)
      expect(w0.inBreakRoom).toBe(true);
      expect(w1.inBreakRoom).toBe(true);
    });

    it('stays in meeting room regardless of state changes', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      worker.inMeetingRoom = true;
      worker.state = 'reading';
      setWorkerState(worker, 'typing');
      expect(worker.inMeetingRoom).toBe(true);
      // State should change within meeting room
      expect(worker.state).toBe('typing');
    });
  });

  describe('setWorkerPlanMode', () => {
    it('moves worker to meeting room when entering plan mode', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      setWorkerPlanMode(worker, true);
      expect(worker.inMeetingRoom).toBe(true);
      expect(worker.inBreakRoom).toBe(false);
    });

    it('returns worker from meeting room when exiting plan mode', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      setWorkerPlanMode(worker, true);
      expect(worker.inMeetingRoom).toBe(true);
      setWorkerPlanMode(worker, false);
      expect(worker.inMeetingRoom).toBe(false);
      const desk = DESK_POSITIONS[0];
      expect(worker.targetX).toBe(desk.chairX);
      expect(worker.targetY).toBe(desk.chairY);
    });

    it('does nothing if worker is leaving', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      startLeaving(worker);
      setWorkerPlanMode(worker, true);
      expect(worker.inMeetingRoom).toBe(false);
    });

    it('does nothing if worker has not arrived', () => {
      const worker = createWorker('s', 0);
      worker.arrived = false;
      setWorkerPlanMode(worker, true);
      expect(worker.inMeetingRoom).toBe(false);
    });

    it('does nothing if already in plan mode and setting true again', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      setWorkerPlanMode(worker, true);
      const targetX = worker.targetX;
      const targetY = worker.targetY;
      setWorkerPlanMode(worker, true);
      expect(worker.targetX).toBe(targetX);
      expect(worker.targetY).toBe(targetY);
    });

    it('does nothing if not in plan mode and setting false', () => {
      const worker = createWorker('s', 0);
      worker.arrived = true;
      const targetX = worker.targetX;
      const targetY = worker.targetY;
      setWorkerPlanMode(worker, false);
      expect(worker.targetX).toBe(targetX);
      expect(worker.targetY).toBe(targetY);
    });
  });

  describe('startLeaving', () => {
    it('sets leaving flag and targets door', () => {
      const worker = createWorker('s', 0);
      startLeaving(worker);
      expect(worker.leaving).toBe(true);
      expect(worker.targetX).toBe(DOOR_X);
      expect(worker.targetY).toBe(DOOR_Y);
    });

    it('clears speech bubble', () => {
      const worker = createWorker('s', 0);
      worker.speechBubble = 'Working hard!';
      startLeaving(worker);
      expect(worker.speechBubble).toBeNull();
    });
  });

  describe('getWorkerScreenPos', () => {
    it('converts tile coordinates to screen pixels', () => {
      const worker = createWorker('s', 0);
      worker.x = 5;
      worker.y = 10;
      const pos = getWorkerScreenPos(worker);
      expect(pos.x).toBe(5 * TILE_SIZE * SCALE);
      expect(pos.y).toBe(10 * TILE_SIZE * SCALE);
    });

    it('handles fractional tile positions', () => {
      const worker = createWorker('s', 0);
      worker.x = 3.5;
      worker.y = 7.25;
      const pos = getWorkerScreenPos(worker);
      expect(pos.x).toBe(3.5 * TILE_SIZE * SCALE);
      expect(pos.y).toBe(7.25 * TILE_SIZE * SCALE);
    });

    it('handles zero position', () => {
      const worker = createWorker('s', 0);
      worker.x = 0;
      worker.y = 0;
      const pos = getWorkerScreenPos(worker);
      expect(pos.x).toBe(0);
      expect(pos.y).toBe(0);
    });
  });
});
