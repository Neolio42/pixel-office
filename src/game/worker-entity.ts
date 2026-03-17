import { WorkerState } from '@/lib/types';
import { FRAMES, FRAME_DURATIONS, AnimState } from './sprites';
import { DESK_POSITIONS, DOOR_X, DOOR_Y, TILE_SIZE, SCALE } from './office-layout';

export type FacingDir = 'down' | 'up' | 'right' | 'left';

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
  // Client-side idle detection
  lastToolTime: number; // Date.now() of last active tool call
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
    lastToolTime: Date.now(),
  };
}

export function updateWorker(worker: WorkerEntity, dt: number): boolean {
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
    if (!worker.arrived) {
      worker.arrived = true;
      worker.state = 'idle';
      worker.facing = 'up'; // face the desk/screen
    } else if (worker.state === 'walking') {
      // Reached a new target after initial arrival (break room trip or returning)
      if (worker.inBreakRoom) {
        worker.state = 'idle';
        worker.facing = 'down'; // relax, face the viewer
      } else {
        worker.state = 'idle';
        worker.facing = 'up'; // back at desk, face the screen
      }
    }
  }

  // Advance animation frame
  const duration = FRAME_DURATIONS[worker.state];
  worker.frameTimer += dt * 1000;
  if (worker.frameTimer >= duration) {
    worker.frameTimer -= duration;
    const frames = FRAMES[worker.state];
    worker.frameIndex = (worker.frameIndex + 1) % frames.length;
  }

  return false;
}

export function setWorkerState(worker: WorkerEntity, state: WorkerState) {
  if (worker.leaving) return;

  if (worker.arrived) {
    // In meeting room: stay there regardless of state changes (plan mode controls exit)
    if (worker.inMeetingRoom) {
      const animState: AnimState = state === 'walking' ? 'walking' : state;
      if (animState !== worker.state && worker.state !== 'walking') {
        worker.state = animState;
        worker.frameIndex = 0;
        worker.frameTimer = 0;
      }
      return;
    }

    if (state === 'idle' && !worker.inBreakRoom) {
      // Go to break room — pick a spot based on desk index
      const spot = BREAK_ROOM_SPOTS[worker.deskIndex % BREAK_ROOM_SPOTS.length];
      worker.targetX = spot.x;
      worker.targetY = spot.y;
      worker.inBreakRoom = true;
      // Walking state will be set by updateWorker when dx/dy detected
      return;
    }

    if (state !== 'idle' && worker.inBreakRoom) {
      // Back to work — return to desk
      const desk = DESK_POSITIONS[worker.deskIndex] || DESK_POSITIONS[0];
      worker.targetX = desk.chairX;
      worker.targetY = desk.chairY;
      worker.inBreakRoom = false;
      return;
    }

    // Normal state change at desk
    const animState: AnimState = state === 'walking' ? 'walking' : state;
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

export function startLeaving(worker: WorkerEntity) {
  worker.leaving = true;
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
