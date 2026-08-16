import { WorkerState } from '@/lib/types';
import { type FacingDir, FRAME_COUNTS, FRAME_DURATIONS, AnimState, toAnimState } from './sprites';
import { DESK_POSITIONS, DOOR_X, DOOR_Y, TILE_SIZE, SCALE } from './office-layout';

export type EmoteType = 'approved' | 'denied' | 'error' | 'done';

export interface WorkerEntity {
  sessionId: string;
  deskIndex: number;
  charIndex: number;   // 0-5, selects which character sheet to use
  // Position in tile coordinates (fractional for smooth movement)
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: AnimState;
  facing: FacingDir;
  frameIndex: number;
  frameTimer: number;
  speechBubble: string | null;
  leaving: boolean;
  arrived: boolean;       // has initially arrived at desk
  inBreakRoom: boolean;   // currently heading to or at break room
  inMeetingRoom: boolean; // currently heading to or at meeting room (plan mode)
  // Drag-to-move: user manually set a target, skip auto break room/meeting room until arrival
  manualTarget: boolean;
  // Floating emote above worker (approval granted, denied, etc)
  emote: { type: EmoteType; timer: number; maxTimer: number } | null;
  // Break room idle behavior
  idleTimer: number;
  nextWanderTime: number; // seconds until next wander
}

const WALK_SPEED = 8; // tiles per second

// Break room positions workers can go to when idle (cols 14-18, rows 1-6)
const BREAK_ROOM_SPOTS = [
  { x: 16, y: 4 },  // in front of coffee table
  { x: 14, y: 3 },  // left of coffee table
  { x: 17, y: 3 },  // right of coffee table
  { x: 15, y: 5 },  // bottom center
  { x: 16, y: 5 },  // bottom center-right
];

// Meeting room positions around the table (cols 14-18, rows 8-13)
const MEETING_ROOM_SPOTS = [
  { x: 15, y: 9 },   // above table left
  { x: 16, y: 9 },   // above table right
  { x: 15, y: 12 },  // below table left
  { x: 16, y: 12 },  // below table right
  { x: 14, y: 10 },  // left of table
];

export function createWorker(sessionId: string, deskIndex: number): WorkerEntity {
  const desk = DESK_POSITIONS[deskIndex] || DESK_POSITIONS[0];
  return {
    sessionId,
    deskIndex,
    charIndex: deskIndex % 6,
    x: DOOR_X,
    y: DOOR_Y,
    targetX: desk.chairX,
    targetY: desk.chairY,
    state: 'walking',
    facing: 'up',
    frameIndex: 0,
    frameTimer: 0,
    speechBubble: null,
    leaving: false,
    arrived: false,
    inBreakRoom: false,
    inMeetingRoom: false,
    manualTarget: false,
    emote: null,
    idleTimer: 0,
    nextWanderTime: 5 + Math.random() * 5,
  };
}

export function updateWorker(worker: WorkerEntity, dt: number): boolean {
  // Tick emote timer
  if (worker.emote) {
    worker.emote.timer -= dt;
    if (worker.emote.timer <= 0) worker.emote = null;
  }

  // Move toward target using L-shaped path
  const dx = worker.targetX - worker.x;
  const dy = worker.targetY - worker.y;

  if (Math.abs(dy) > 0.1 || Math.abs(dx) > 0.1) {
    let moveX = 0;
    let moveY = 0;

    if (worker.leaving) {
      // Leaving: horizontal first, then vertical
      if (Math.abs(dx) > 0.1) {
        moveX = dx;
      } else {
        moveY = dy;
      }
    } else {
      // Arriving: vertical first, then horizontal
      if (Math.abs(dy) > 0.1) {
        moveY = dy;
      } else {
        moveX = dx;
      }
    }

    const moveDist = Math.sqrt(moveX * moveX + moveY * moveY);
    const step = Math.min(WALK_SPEED * dt, moveDist);
    worker.x += (moveX / moveDist) * step;
    worker.y += (moveY / moveDist) * step;
    worker.state = 'walking';

    // Set facing direction based on movement
    if (Math.abs(moveY) > Math.abs(moveX)) {
      worker.facing = moveY < 0 ? 'up' : 'down';
    } else {
      worker.facing = moveX < 0 ? 'left' : 'right';
    }
  } else {
    worker.x = worker.targetX;
    worker.y = worker.targetY;
    if (worker.leaving && worker.targetX === DOOR_X && worker.targetY === DOOR_Y) {
      return true; // signal removal
    }
    // Clear manual target on arrival
    if (worker.manualTarget) {
      worker.manualTarget = false;
    }
    if (!worker.arrived) {
      worker.arrived = true;
      worker.state = 'idle';
      worker.facing = 'up'; // face the desk/screen
    } else if (worker.state === 'walking') {
      // Reached a new target after initial arrival (break room trip or returning)
      if (worker.inBreakRoom) {
        worker.state = 'idle';
        worker.facing = 'down'; // relax, face the viewer
      } else if (worker.inMeetingRoom) {
        worker.state = 'idle';
        worker.facing = 'up'; // face the whiteboard
      } else {
        worker.state = 'idle';
        worker.facing = 'up'; // back at desk, face the screen
      }
    }

    // Idle wandering in break room
    if (worker.inBreakRoom && worker.state === 'idle') {
      worker.idleTimer += dt;
      if (worker.idleTimer >= worker.nextWanderTime) {
        worker.idleTimer = 0;
        worker.nextWanderTime = 5 + Math.random() * 8;
        // Pick a random break room spot different from current
        const spot = BREAK_ROOM_SPOTS[Math.floor(Math.random() * BREAK_ROOM_SPOTS.length)];
        if (Math.abs(spot.x - worker.x) > 0.5 || Math.abs(spot.y - worker.y) > 0.5) {
          worker.targetX = spot.x;
          worker.targetY = spot.y;
        } else {
          // Just change facing direction for variety
          const dirs: FacingDir[] = ['down', 'left', 'right'];
          worker.facing = dirs[Math.floor(Math.random() * dirs.length)];
        }
      }
    } else if (worker.inMeetingRoom && worker.state === 'idle') {
      // Meeting room: occasional facing changes
      worker.idleTimer += dt;
      if (worker.idleTimer >= worker.nextWanderTime) {
        worker.idleTimer = 0;
        worker.nextWanderTime = 3 + Math.random() * 5;
        const dirs: FacingDir[] = ['up', 'left', 'right', 'down'];
        worker.facing = dirs[Math.floor(Math.random() * dirs.length)];
      }
    }
  }

  // Advance animation frame
  const duration = FRAME_DURATIONS[worker.state];
  worker.frameTimer += dt * 1000;
  if (worker.frameTimer >= duration) {
    worker.frameTimer -= duration;
    worker.frameIndex = (worker.frameIndex + 1) % FRAME_COUNTS[worker.state];
  }

  return false;
}

export function setWorkerState(worker: WorkerEntity, state: WorkerState) {
  if (worker.leaving) return;

  if (worker.arrived) {
    // In meeting room: stay there regardless of state changes (plan mode controls exit)
    if (worker.inMeetingRoom) {
      const animState: AnimState = toAnimState(state);
      if (animState !== worker.state && worker.state !== 'walking') {
        worker.state = animState;
        worker.frameIndex = 0;
        worker.frameTimer = 0;
      }
      return;
    }

    // Manual target active — update animation but skip location redirects
    if (worker.manualTarget) {
      const animState: AnimState = toAnimState(state);
      if (animState !== worker.state && worker.state !== 'walking') {
        worker.state = animState;
        worker.frameIndex = 0;
        worker.frameTimer = 0;
      }
      return;
    }

    // Treat "done" like idle for routing — worker has finished, can wander.
    const routingState: WorkerState = state === 'done' ? 'idle' : state;

    if (routingState === 'idle' && !worker.inBreakRoom && !worker.manualTarget) {
      // Go to break room — pick a spot based on desk index
      const spot = BREAK_ROOM_SPOTS[worker.deskIndex % BREAK_ROOM_SPOTS.length];
      worker.targetX = spot.x;
      worker.targetY = spot.y;
      worker.inBreakRoom = true;
      worker.idleTimer = 0;
      // Walking state will be set by updateWorker when dx/dy detected
      return;
    }

    if (routingState !== 'idle' && worker.inBreakRoom) {
      // Back to work — return to desk
      const desk = DESK_POSITIONS[worker.deskIndex] || DESK_POSITIONS[0];
      worker.targetX = desk.chairX;
      worker.targetY = desk.chairY;
      worker.inBreakRoom = false;
      worker.idleTimer = 0;
      return;
    }

    // Normal state change at desk
    const animState: AnimState = toAnimState(state);
    if (animState !== worker.state) {
      worker.state = animState;
      worker.frameIndex = 0;
      worker.frameTimer = 0;
    }
  }
}

export function setWorkerPlanMode(worker: WorkerEntity, inPlanMode: boolean) {
  if (worker.leaving) return;
  if (!worker.arrived) return;

  if (inPlanMode && !worker.inMeetingRoom) {
    // Move to meeting room
    const spot = MEETING_ROOM_SPOTS[worker.deskIndex % MEETING_ROOM_SPOTS.length];
    worker.targetX = spot.x;
    worker.targetY = spot.y;
    worker.inMeetingRoom = true;
    worker.inBreakRoom = false;
  } else if (!inPlanMode && worker.inMeetingRoom) {
    // Return to desk
    const desk = DESK_POSITIONS[worker.deskIndex] || DESK_POSITIONS[0];
    worker.targetX = desk.chairX;
    worker.targetY = desk.chairY;
    worker.inMeetingRoom = false;
  }
}

export function setManualTarget(worker: WorkerEntity, tx: number, ty: number) {
  if (worker.leaving || !worker.arrived) return;
  worker.targetX = tx;
  worker.targetY = ty;
  worker.manualTarget = true;
  worker.inBreakRoom = false;
  worker.inMeetingRoom = false;
  worker.idleTimer = 0;
}

const EMOTE_DURATION = 1.5; // seconds

export function triggerEmote(worker: WorkerEntity, type: EmoteType) {
  worker.emote = { type, timer: EMOTE_DURATION, maxTimer: EMOTE_DURATION };
}

export function startLeaving(worker: WorkerEntity) {
  worker.leaving = true;
  worker.manualTarget = false;
  worker.targetX = DOOR_X;
  worker.targetY = DOOR_Y;
  worker.speechBubble = null;
}

export function getWorkerScreenPos(worker: WorkerEntity): { x: number; y: number } {
  return {
    x: worker.x * TILE_SIZE * SCALE,
    y: worker.y * TILE_SIZE * SCALE,
  };
}
