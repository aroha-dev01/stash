// Designed illustrations for the toolkits, since a category has no product
// image of its own. One visual language: chalk hairlines on carbon, one amber
// element per drawing for the thing the toolkit is about.

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, vectorEffect: 'non-scaling-stroke' };
const A = { ...S, stroke: 'var(--color-accent)' };

function UiUx() {
  return (
    <>
      <rect x='30' y='18' width='260' height='150' rx='10' {...S} />
      <path d='M30 40h260' {...S} />
      <circle cx='44' cy='29' r='3' {...S} /><circle cx='56' cy='29' r='3' {...S} /><circle cx='68' cy='29' r='3' {...S} />
      <rect x='46' y='56' width='110' height='14' rx='3' {...S} opacity='.7' />
      <rect x='46' y='78' width='80' height='8' rx='2' {...S} opacity='.45' />
      <rect x='46' y='100' width='64' height='22' rx='11' {...A} className='k-art-pulse' />
      <rect x='176' y='56' width='98' height='96' rx='8' {...S} opacity='.6' />
      <path d='M188 136l18-22 14 14 12-10 30 18' {...S} opacity='.6' />
      <path d='M46 140h100' {...S} opacity='.35' strokeDasharray='4 4' />
      <path d='M232 118l12 30 5-12 12-3z' fill='var(--color-surface-raised)' stroke='currentColor' strokeWidth='1.2' className='k-art-cursor' />
    </>
  );
}

function Content() {
  return (
    <>
      <rect x='60' y='34' width='150' height='100' rx='8' {...S} opacity='.45' transform='rotate(-6 135 84)' />
      <rect x='86' y='28' width='150' height='100' rx='8' {...S} />
      <path d='M98 112l32-34 22 22 16-14 26 26' {...S} />
      <circle cx='206' cy='54' r='9' {...A} />
      <path d='M40 160c8-14 14 14 22 0s14 14 22 0 14 14 22 0 14 14 22 0 14 14 22 0 14 14 22 0 14 14 22 0 14 14 22 0 14 14 22 0' {...S} opacity='.55' className='k-art-wave' />
      <circle cx='262' cy='98' r='20' {...S} />
      <path d='M256 88v20l16-10z' fill='currentColor' opacity='.8' />
    </>
  );
}

function Automation() {
  const nodes = [[54, 92], [130, 52], [130, 132], [206, 92], [276, 92]];
  return (
    <>
      <path d='M54 92C90 92 96 52 130 52M54 92c36 0 42 40 76 40M130 52c36 0 42 40 76 40M130 132c36 0 42-40 76-40M206 92h70' {...S} opacity='.55' />
      <path d='M54 92C90 92 96 52 130 52c36 0 42 40 76 40h70' {...A} strokeDasharray='6 220' className='k-art-flow' />
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i === 0 ? 14 : 11} fill='var(--color-surface-raised)' {...(i === 0 ? A : S)} />
          {i === 0 ? <path d={`M${x - 4} ${y - 5}l8 5-8 5z`} fill='var(--color-accent)' /> : <path d={`M${x - 4} ${y}h8`} {...S} />}
        </g>
      ))}
      <text x='40' y='126' fill='currentColor' opacity='.5' fontSize='9' fontFamily='var(--font-code)'>trigger</text>
      <text x='258' y='126' fill='currentColor' opacity='.5' fontSize='9' fontFamily='var(--font-code)'>done</text>
    </>
  );
}

function Development() {
  return (
    <>
      <rect x='40' y='22' width='240' height='140' rx='10' {...S} />
      <path d='M40 44h240' {...S} />
      <path d='M60 68l12 10-12 10' {...A} />
      <path d='M82 88h40' {...S} />
      <path d='M60 108h120M60 124h86M60 140h150' {...S} opacity='.4' />
      <rect x='186' y='60' width='76' height='36' rx='6' {...S} opacity='.6' />
      <path d='M198 78h52' {...S} opacity='.6' />
      <path d='M128 88h2' stroke='var(--color-accent)' strokeWidth='8' className='k-art-caret' />
    </>
  );
}

function Research() {
  const bars = [46, 70, 58, 96, 84, 118];
  return (
    <>
      <path d='M44 160h240M44 160V24' {...S} opacity='.5' />
      {bars.map((h, i) => (
        <rect key={i} x={62 + i * 36} y={160 - h} width='20' height={h} rx='3' {...S} opacity={0.35 + i * 0.08} />
      ))}
      <path d='M72 118l36-26 36 12 36-38 36 10 36-34' {...A} />
      <circle cx='252' cy='42' r='4' fill='var(--color-accent)' />
    </>
  );
}

const ART = { 'ui-ux': UiUx, content: Content, automation: Automation, development: Development, research: Research };

export default function CategoryArt({ toolkit }) {
  const Art = ART[toolkit] || Research;
  return (
    <svg className='k-art' viewBox='0 0 320 180' aria-hidden='true'>
      <Art />
    </svg>
  );
}
