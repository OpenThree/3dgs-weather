// 调度云内 / 云地闪：先导生长、回击与多次回击，并驱动场景闪白与延迟雷声。
// 通道折线参考中点偏移分叉（drilian / LightningStrike），时序参考真实回击间隔。

import * as THREE from 'three';
import type { ThunderSky } from './ThunderSky';

/**
 * 改进后的雷电调度。
 * - 先导沿通道生长，再出现回击主峰与 1～4 次后续回击
 * - 方向偏世界空间云层，不再紧贴相机视锥中心
 * - 白芯偏蓝，场景环境光短暂抬亮
 * - 雷声按估计距离延迟
 */

const SLOT_COUNT = 3;
/** 两组雷暴之间的等待，单位秒。 */
const FLASH_INTERVAL_MIN = 2.8;
const FLASH_INTERVAL_MAX = 6.5;
/** 声速，km/s，用于雷声延迟。 */
const SOUND_SPEED_KM_S = 0.343;

type BoltKind = 'ic' | 'cg';

type BoltEvent = {
	startTime: number;
	leaderDuration: number;
	strokeCount: number;
	strokeInterval: number;
	cloudPeak: number;
	boltPeak: number;
	hasVisibleBolt: boolean;
	kind: BoltKind;
	/** 估计闪光距离，公里，用于雷声延迟。 */
	distanceKm: number;
};

type InteractionMode = 'cross' | 'near' | 'separate';

type BoltBasis = {
	right: THREE.Vector3;
	up: THREE.Vector3;
};

type BoltCandidate = {
	direction: THREE.Vector3;
	angle: number;
	length: number;
	width: number;
	bend: number;
	jaggedness: number;
	branchStrength: number;
	branchStart: number;
	branchSlope: number;
	cloudRadius: number;
	cloudStretch: number;
	seed: number;
	screenX: number;
	screenY: number;
	kind: BoltKind;
	distanceKm: number;
	basis: BoltBasis;
};

type Segment2D = {
	a: { x: number; y: number };
	b: { x: number; y: number };
};

export type LightningStormOptions = {
	/** 每帧场景闪白强度，0～1。 */
	onSceneFlash?: ( intensity: number ) => void;
	/** 带距离延迟的雷声。 */
	onThunder?: ( delaySec: number ) => void;
};

/** 调度闪电分组，限制路径位于云层，并为每组触发一次延迟雷声。 */
export class LightningStorm {

	private enabled = false;
	private timer = 0;
	private nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );
	private groupActive = false;
	private groupTime = 0;
	private groupEndTime = 0;
	private sceneFlash = 0;
	private readonly boltEvents: Array<BoltEvent | null> = [ null, null, null ];
	private readonly cameraDirection = new THREE.Vector3();
	private readonly right = new THREE.Vector3();
	private readonly up = new THREE.Vector3();
	private readonly scratch = new THREE.Vector3();
	private readonly onSceneFlash?: ( intensity: number ) => void;
	private readonly onThunder?: ( delaySec: number ) => void;

	constructor(
		private readonly sky: ThunderSky,
		options: LightningStormOptions = {}
	) {

		this.onSceneFlash = options.onSceneFlash;
		this.onThunder = options.onThunder;

	}

	/** 当前帧应叠加到场景环境光上的闪白强度。 */
	getSceneFlash() {

		return this.sceneFlash;

	}

	/** 切换雷电调度，关闭时清空当前雷电槽位。 */
	setEnabled( enabled: boolean ) {

		this.enabled = enabled;

		if ( ! enabled ) {

			this.timer = 0;
			this.groupActive = false;
			this.sceneFlash = 0;
			this.onSceneFlash?.( 0 );
			this.clearSlots();

		} else {

			this.nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );

		}

	}

	/** 按帧间隔秒数推进雷电分组时序。 */
	update( camera: THREE.Camera, delta: number ) {

		if ( ! this.enabled ) {

			this.sceneFlash = 0;
			this.onSceneFlash?.( 0 );
			return;

		}

		this.timer += delta;

		if ( ! this.groupActive && this.timer >= this.nextFlash ) {

			this.timer = 0;
			this.trigger( camera );
			this.nextFlash = THREE.MathUtils.randFloat( FLASH_INTERVAL_MIN, FLASH_INTERVAL_MAX );

		}

		this.updateGroup( delta );

	}

	private trigger( camera: THREE.Camera ) {

		camera.getWorldDirection( this.cameraDirection );
		this.groupActive = true;
		this.groupTime = 0;
		this.groupEndTime = 0;
		this.sceneFlash = 0;

		// 约四成只有云内闪光；其余里约三分之一偏云地闪外观。
		const cloudOnly = Math.random() < 0.38;
		const preferCg = ! cloudOnly && Math.random() < 0.34;
		const visibleCount = cloudOnly ? 0 : THREE.MathUtils.randInt( 1, 3 );

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			this.setSlot( i, 'lightningStrength', 0 );
			this.setSlot( i, 'cloudFlashStrength', 0 );
			this.setSlot( i, 'lightningProgress', 0 );
			this.boltEvents[ i ] = null;

		}

		let thunderDistanceKm = THREE.MathUtils.randFloat( 1.2, 6.5 );

		if ( cloudOnly ) {

			this.randomizeBoltShape( camera, 0, [], 'ic' );
			const leaderDuration = THREE.MathUtils.randFloat( 0.05, 0.14 );
			const strokeCount = THREE.MathUtils.randInt( 1, 3 );
			const strokeInterval = THREE.MathUtils.randFloat( 0.035, 0.09 );
			const startTime = THREE.MathUtils.randFloat( 0.0, 0.08 );
			const hold = leaderDuration + strokeCount * strokeInterval + 0.12;
			this.boltEvents[ 0 ] = {
				startTime,
				leaderDuration,
				strokeCount,
				strokeInterval,
				cloudPeak: THREE.MathUtils.randFloat( 0.7, 2.1 ),
				boltPeak: 0,
				hasVisibleBolt: false,
				kind: 'ic',
				distanceKm: thunderDistanceKm
			};
			this.groupEndTime = startTime + hold + 0.2;
			this.queueThunder( thunderDistanceKm );
			return;

		}

		const acceptedBolts: BoltCandidate[] = [];
		let previousStart = THREE.MathUtils.randFloat( 0.0, 0.08 );

		for ( let i = 0; i < visibleCount; i ++ ) {

			const kind: BoltKind = preferCg && i === 0 ? 'cg' : 'ic';
			const accepted = this.randomizeBoltShape( camera, i, acceptedBolts, kind );

			if ( accepted ) {

				acceptedBolts.push( accepted );
				thunderDistanceKm = Math.min( thunderDistanceKm, accepted.distanceKm );

			}

			let startTime = previousStart;

			if ( i > 0 ) {

				startTime = previousStart + THREE.MathUtils.randFloat( 0.01, 0.16 );
				previousStart = startTime;

			}

			const leaderDuration = THREE.MathUtils.randFloat( 0.045, 0.12 );
			const strokeCount = THREE.MathUtils.randInt( 1, 4 );
			const strokeInterval = THREE.MathUtils.randFloat( 0.03, 0.085 );
			const hold = leaderDuration + strokeCount * strokeInterval + 0.1;
			this.boltEvents[ i ] = {
				startTime,
				leaderDuration,
				strokeCount,
				strokeInterval,
				cloudPeak: THREE.MathUtils.randFloat( 0.65, 2.2 ),
				boltPeak: THREE.MathUtils.randFloat( 0.9, 2.35 ),
				hasVisibleBolt: true,
				kind,
				distanceKm: accepted?.distanceKm ?? thunderDistanceKm
			};
			this.groupEndTime = Math.max( this.groupEndTime, startTime + hold + 0.22 );

		}

		this.queueThunder( thunderDistanceKm );

	}

	private queueThunder( distanceKm: number ) {

		const delaySec = THREE.MathUtils.clamp( distanceKm / SOUND_SPEED_KM_S, 0.35, 7.5 );
		this.onThunder?.( delaySec );

	}

	private updateGroup( delta: number ) {

		if ( ! this.groupActive ) {

			this.sceneFlash = 0;
			this.onSceneFlash?.( 0 );
			return;

		}

		this.groupTime += delta;
		let maxFlash = 0;

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			const event = this.boltEvents[ i ];

			if ( ! event ) {

				continue;

			}

			const localTime = this.groupTime - event.startTime;
			const phase = evaluateDischarge( localTime, event );
			const cloudPulse = Math.min( phase.cloud, 1.9 );
			const boltPulse = Math.min( phase.bolt, 1.9 );

			this.setSlot( i, 'lightningProgress', phase.progress );
			this.setSlot( i, 'cloudFlashStrength', cloudPulse * event.cloudPeak );
			this.setSlot(
				i,
				'lightningStrength',
				event.hasVisibleBolt ? boltPulse * event.boltPeak : 0
			);

			const flash = Math.max( cloudPulse * event.cloudPeak * 0.22, boltPulse * event.boltPeak * 0.45 );
			maxFlash = Math.max( maxFlash, flash );

		}

		// 回击瞬间抬高场景闪白，先导阶段只给很弱的氛围。
		this.sceneFlash = THREE.MathUtils.clamp( maxFlash * 0.55, 0, 1.25 );
		this.onSceneFlash?.( this.sceneFlash );

		if ( this.groupTime > this.groupEndTime ) {

			this.groupActive = false;
			this.sceneFlash = 0;
			this.onSceneFlash?.( 0 );
			this.clearSlots();

		}

	}

	private randomizeBoltShape(
		camera: THREE.Camera,
		index: number,
		acceptedBolts: BoltCandidate[],
		kind: BoltKind
	) {

		this.right.set( 1, 0, 0 ).applyQuaternion( camera.quaternion );
		this.up.set( 0, 1, 0 ).applyQuaternion( camera.quaternion );

		const relationRoll = Math.random();
		const interactionMode: InteractionMode = relationRoll < 0.08
			? 'cross'
			: relationRoll < 0.28
				? 'near'
				: 'separate';

		let bestCandidate: BoltCandidate | null = null;
		let bestScore = - Infinity;

		for ( let attempt = 0; attempt < 36; attempt ++ ) {

			const candidate = this.makeCandidate( camera, kind );
			const continuity = evaluateCloudContinuity( candidate, this.sky );
			const conflict = candidateConflicts( candidate, acceptedBolts, interactionMode );
			const verticalBonus = kind === 'cg'
				? Math.abs( Math.sin( candidate.angle ) ) * 0.25
				: 0;
			const score = continuity.average - continuity.maxClearRun * 0.18 - ( conflict ? 0.35 : 0 ) + verticalBonus;

			if ( score > bestScore ) {

				bestScore = score;
				bestCandidate = candidate;

			}

			if ( continuity.valid && ! conflict ) {

				bestCandidate = candidate;
				break;

			}

		}

		if ( bestCandidate === null ) {

			return null;

		}

		if ( ! evaluateCloudContinuity( bestCandidate, this.sky ).valid ) {

			bestCandidate.length *= kind === 'cg' ? 0.78 : 0.62;

		}

		( this.uniform( index, 'lightningDirection' ).value as THREE.Vector3 ).copy( bestCandidate.direction );
		this.setSlot( index, 'lightningSeed', bestCandidate.seed );
		this.setSlot( index, 'lightningAngle', bestCandidate.angle );
		this.setSlot( index, 'lightningLength', bestCandidate.length );
		this.setSlot( index, 'lightningWidth', bestCandidate.width );
		this.setSlot( index, 'lightningBend', bestCandidate.bend );
		this.setSlot( index, 'lightningJaggedness', bestCandidate.jaggedness );
		this.setSlot( index, 'lightningBranchStrength', bestCandidate.branchStrength );
		this.setSlot( index, 'lightningBranchStart', bestCandidate.branchStart );
		this.setSlot( index, 'lightningBranchSlope', bestCandidate.branchSlope );
		this.setSlot( index, 'lightningCloudRadius', bestCandidate.cloudRadius );
		this.setSlot( index, 'lightningCloudStretch', bestCandidate.cloudStretch );
		this.setSlot( index, 'lightningProgress', 0 );

		// 白芯偏冷蓝，避免原来的装饰紫。
		( this.uniform( index, 'lightningColor' ).value as THREE.Color ).setRGB(
			THREE.MathUtils.randFloat( 0.78, 0.95 ),
			THREE.MathUtils.randFloat( 0.88, 0.98 ),
			1.0,
			THREE.SRGBColorSpace
		);

		return bestCandidate;

	}

	/** 在云层区域采样方向：保留一点相机朝向，但主要用世界方位，避免闪电视线锁定。 */
	private makeCandidate( camera: THREE.Camera, kind: BoltKind ): BoltCandidate {

		const view = camera as THREE.PerspectiveCamera;
		const halfTanY = Math.tan( THREE.MathUtils.degToRad( view.fov ) * 0.5 );
		const halfTanX = halfTanY * view.aspect;

		// 世界方位：绕上方向随机偏转，再混一点相机朝向，使下一次闪不会总贴视野中心。
		const azimuth = THREE.MathUtils.randFloat( - Math.PI, Math.PI );
		const elevation = kind === 'cg'
			? THREE.MathUtils.randFloat( 0.12, 0.48 )
			: THREE.MathUtils.randFloat( 0.22, 0.78 );
		this.scratch.set(
			Math.cos( elevation ) * Math.sin( azimuth ),
			Math.sin( elevation ),
			Math.cos( elevation ) * Math.cos( azimuth )
		).normalize();
		const direction = this.scratch.clone()
			.multiplyScalar( 0.72 )
			.addScaledVector( this.cameraDirection, 0.28 )
			.normalize();
		if ( direction.y < 0.08 ) {

			direction.y = 0.08;
			direction.normalize();

		}

		// 投影到近似屏幕偏移，供多道闪电避让使用。
		const screenX = THREE.MathUtils.clamp(
			direction.dot( this.right ) / Math.max( halfTanX, 1e-4 ),
			- 1.35,
			1.35
		) * halfTanX;
		const screenY = THREE.MathUtils.clamp(
			direction.dot( this.up ) / Math.max( halfTanY, 1e-4 ),
			- 1.15,
			1.15
		) * halfTanY;

		const vertical = kind === 'cg'
			? THREE.MathUtils.degToRad( THREE.MathUtils.randFloat( 62, 88 ) ) * ( Math.random() < 0.5 ? 1 : - 1 )
			: THREE.MathUtils.degToRad( THREE.MathUtils.randFloat( - 78, 78 ) );

		return {
			direction,
			angle: vertical,
			length: kind === 'cg'
				? THREE.MathUtils.randFloat( 0.28, 0.72 )
				: THREE.MathUtils.randFloat( 0.16, 0.55 ),
			width: THREE.MathUtils.randFloat( 0.00085, 0.0022 ),
			bend: THREE.MathUtils.randFloat( - 0.28, 0.28 ),
			jaggedness: THREE.MathUtils.randFloat( 0.75, 1.85 ),
			branchStrength: kind === 'cg'
				? THREE.MathUtils.randFloat( 0.45, 1 )
				: THREE.MathUtils.randFloat( 0.15, 0.95 ),
			branchStart: THREE.MathUtils.randFloat( - 0.1, 0.08 ),
			branchSlope: THREE.MathUtils.randFloat( - 0.85, 0.85 ),
			cloudRadius: THREE.MathUtils.randFloat( 0.08, 0.28 ),
			cloudStretch: THREE.MathUtils.randFloat( 0.9, 3.6 ),
			seed: Math.random() * 1000,
			screenX,
			screenY,
			kind,
			distanceKm: THREE.MathUtils.randFloat( kind === 'cg' ? 0.8 : 1.5, kind === 'cg' ? 5.5 : 8.0 ),
			basis: lightningBasis( direction )
		};

	}

	private clearSlots() {

		for ( let i = 0; i < SLOT_COUNT; i ++ ) {

			this.setSlot( i, 'lightningStrength', 0 );
			this.setSlot( i, 'cloudFlashStrength', 0 );
			this.setSlot( i, 'lightningProgress', 0 );
			this.boltEvents[ i ] = null;

		}

	}

	private uniform( index: number, name: string ) {

		return this.sky.material.uniforms[ `${ name }${ index }` ];

	}

	private setSlot( index: number, name: string, value: number ) {

		this.uniform( index, name ).value = value;

	}

}

/**
 * 先导生长 → 回击尖峰 → 后续回击。
 * progress 控制通道显露；bolt / cloud 控制亮度。
 */
function evaluateDischarge( t: number, event: BoltEvent ) {

	if ( t < 0 ) {

		return { progress: 0, bolt: 0, cloud: 0 };

	}

	const { leaderDuration, strokeCount, strokeInterval } = event;

	if ( t < leaderDuration ) {

		const u = t / Math.max( leaderDuration, 1e-4 );
		// 先导又暗又短，只勾出通道轮廓。
		return {
			progress: THREE.MathUtils.smoothstep( 0, 1, u ),
			bolt: event.hasVisibleBolt ? 0.12 + u * 0.22 : 0,
			cloud: 0.18 + u * 0.45
		};

	}

	const afterLeader = t - leaderDuration;
	let bolt = 0;
	let cloud = 0;

	for ( let s = 0; s < strokeCount; s ++ ) {

		const local = afterLeader - s * strokeInterval;
		if ( local < 0 || local > strokeInterval * 1.35 ) {

			continue;

		}

		// 回击：极短上升 + 较快衰减，后续回击逐次变弱。
		const attack = 0.008 + s * 0.002;
		const fall = 0.045 + s * 0.012;
		let pulse = 0;

		if ( local < attack ) {

			pulse = local / attack;

		} else {

			pulse = Math.exp( - ( local - attack ) / fall );

		}

		const weight = Math.pow( 0.62, s );
		bolt = Math.max( bolt, pulse * weight );
		cloud = Math.max( cloud, pulse * weight * ( s === 0 ? 1 : 0.75 ) );

	}

	// 回击之后通道仍完整可见，直到组结束。
	return {
		progress: 1,
		bolt: event.hasVisibleBolt ? bolt : 0,
		cloud: Math.max( cloud, bolt * 0.35 )
	};

}

function fract( v: number ) {

	return v - Math.floor( v );

}

function smoothstepJS( edge0: number, edge1: number, x: number ) {

	const t = THREE.MathUtils.clamp( ( x - edge0 ) / ( edge1 - edge0 ), 0, 1 );
	return t * t * ( 3 - 2 * t );

}

function cloudGradient( x: number, y: number ) {

	let px = fract( x * 0.1031 );
	let py = fract( y * 0.1030 );
	let pz = fract( x * 0.0973 );
	const dotValue = px * ( py + 33.33 ) + py * ( pz + 33.33 ) + pz * ( px + 33.33 );
	px += dotValue;
	py += dotValue;
	pz += dotValue;

	return [
		fract( ( px + py ) * pz ) * 2 - 1,
		fract( ( px + pz ) * py ) * 2 - 1
	];

}

function cloudNoise2D( x: number, y: number ) {

	const ix = Math.floor( x );
	const iy = Math.floor( y );
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * fx * ( fx * ( fx * 6 - 15 ) + 10 );
	const uy = fy * fy * fy * ( fy * ( fy * 6 - 15 ) + 10 );
	const g00 = cloudGradient( ix, iy );
	const g10 = cloudGradient( ix + 1, iy );
	const g01 = cloudGradient( ix, iy + 1 );
	const g11 = cloudGradient( ix + 1, iy + 1 );
	const a = g00[ 0 ] * fx + g00[ 1 ] * fy;
	const b = g10[ 0 ] * ( fx - 1 ) + g10[ 1 ] * fy;
	const c = g01[ 0 ] * fx + g01[ 1 ] * ( fy - 1 );
	const d = g11[ 0 ] * ( fx - 1 ) + g11[ 1 ] * ( fy - 1 );
	const ab = THREE.MathUtils.lerp( a, b, ux );
	const cd = THREE.MathUtils.lerp( c, d, ux );

	return THREE.MathUtils.lerp( ab, cd, uy ) * 1.6;

}

function cloudFBM( x: number, y: number, drift: number ) {

	let result = 0;
	let amplitude = 1;

	for ( let i = 0; i < 4; i ++ ) {

		result += amplitude * cloudNoise2D( x, y );
		amplitude *= 0.5;
		x = x * 2 + drift;
		y = y * 2 + drift;

	}

	return result;

}

function skyNumber( sky: ThunderSky, name: string ) {

	return sky.material.uniforms[ name ].value as number;

}

function cloudPresenceForDirection( direction: THREE.Vector3, sky: ThunderSky ) {

	if ( direction.y <= 0 ) {

		return 0;

	}

	const elevation = THREE.MathUtils.lerp( 1.0, 0.1, skyNumber( sky, 'cloudElevation' ) );
	const denom = direction.y * elevation;
	let uvX = direction.x / denom * skyNumber( sky, 'cloudScale' );
	let uvY = direction.z / denom * skyNumber( sky, 'cloudScale' );
	const time = skyNumber( sky, 'cloudTime' );
	const speed = skyNumber( sky, 'cloudSpeed' );
	uvX += time * speed;
	uvY += time * speed;
	const evolve = time * speed * 300.0;
	const cloudNoise = THREE.MathUtils.clamp(
		cloudFBM( uvX * 1000, uvY * 1000, evolve ) * 0.7 + 0.5,
		0,
		1
	);
	const region = cloudNoise2D( uvX * 300, uvY * 300 ) * 0.37 + 0.5;
	const cov = THREE.MathUtils.clamp(
		skyNumber( sky, 'cloudCoverage' ) + ( region - 0.5 ) * 0.6,
		0,
		1
	);
	const threshold = 1 - cov;
	const cloudMask = smoothstepJS( threshold, threshold + 0.3, cloudNoise );
	const horizonFade = smoothstepJS( 0, 0.03 + 0.06 * skyNumber( sky, 'cloudElevation' ), direction.y );

	return cloudMask * horizonFade;

}

function lightningBasis( centerDirection: THREE.Vector3 ): BoltBasis {

	const right = new THREE.Vector3().crossVectors( new THREE.Vector3( 0, 1, 0 ), centerDirection );

	if ( right.lengthSq() < 1e-6 ) {

		right.set( 1, 0, 0 );

	} else {

		right.normalize();

	}

	const up = new THREE.Vector3().crossVectors( centerDirection, right ).normalize();

	return { right, up };

}

function candidateDirectionAt( candidate: BoltCandidate, normalizedT: number ) {

	const halfLength = candidate.length * 0.5;
	const x = THREE.MathUtils.lerp( - halfLength, halfLength, normalizedT );
	const y = candidate.bend * ( x * x - x * 0.08 );
	const c = Math.cos( candidate.angle );
	const s = Math.sin( candidate.angle );
	const x0 = x * c - y * s;
	const y0 = x * s + y * c;

	return candidate.direction.clone()
		.addScaledVector( candidate.basis.right, x0 )
		.addScaledVector( candidate.basis.up, y0 )
		.normalize();

}

function evaluateCloudContinuity( candidate: BoltCandidate, sky: ThunderSky ) {

	const sampleCount = 13;
	let total = 0;
	let clearRun = 0;
	let maxClearRun = 0;
	let cloudSamples = 0;
	// 云地闪允许更多晴空段，通道可以探出云底。
	const maxClear = candidate.kind === 'cg' ? 3 : 1;
	const minCloud = candidate.kind === 'cg' ? 7 : 10;
	const minAverage = candidate.kind === 'cg' ? 0.12 : 0.19;

	for ( let i = 0; i < sampleCount; i ++ ) {

		const presence = cloudPresenceForDirection(
			candidateDirectionAt( candidate, i / ( sampleCount - 1 ) ),
			sky
		);
		total += presence;

		if ( presence > 0.10 ) {

			cloudSamples ++;
			clearRun = 0;

		} else {

			clearRun ++;
			maxClearRun = Math.max( maxClearRun, clearRun );

		}

	}

	const average = total / sampleCount;

	return {
		valid: maxClearRun <= maxClear && cloudSamples >= minCloud && average >= minAverage,
		average,
		maxClearRun,
		cloudSamples
	};

}

function boltSegment2D( candidate: BoltCandidate ): Segment2D {

	const half = candidate.length * 0.5;
	const dx = Math.cos( candidate.angle ) * half;
	const dy = Math.sin( candidate.angle ) * half;

	return {
		a: { x: candidate.screenX - dx, y: candidate.screenY - dy },
		b: { x: candidate.screenX + dx, y: candidate.screenY + dy }
	};

}

function orient2D(
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number }
) {

	return ( b.x - a.x ) * ( c.y - a.y ) - ( b.y - a.y ) * ( c.x - a.x );

}

function segmentsCross( s1: Segment2D, s2: Segment2D ) {

	const o1 = orient2D( s1.a, s1.b, s2.a );
	const o2 = orient2D( s1.a, s1.b, s2.b );
	const o3 = orient2D( s2.a, s2.b, s1.a );
	const o4 = orient2D( s2.a, s2.b, s1.b );

	return o1 * o2 < 0 && o3 * o4 < 0;

}

function candidateConflicts(
	candidate: BoltCandidate,
	acceptedBolts: BoltCandidate[],
	interactionMode: InteractionMode
) {

	if ( acceptedBolts.length === 0 ) {

		return false;

	}

	const segment = boltSegment2D( candidate );

	for ( const previous of acceptedBolts ) {

		const crossing = segmentsCross( segment, boltSegment2D( previous ) );
		const centerDistance = Math.hypot(
			candidate.screenX - previous.screenX,
			candidate.screenY - previous.screenY
		);

		if ( interactionMode !== 'cross' && crossing ) {

			return true;

		}

		if ( interactionMode === 'separate' && centerDistance < 0.13 ) {

			return true;

		}

	}

	return false;

}
