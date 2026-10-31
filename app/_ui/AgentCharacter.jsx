import { CLIENTS } from './agents';

// A small character for each coding agent: one shared body, so the three
// match in size and detail, with the agent's own mark on a chest panel. The
// mark is drawn square in its own 24-unit box and never stretched, recoloured
// beyond its single brand tone, or mirrored. The body is ours, not an official
// mascot; the label beside it says which tool it stands for.
//
// Motion lives in landing.css and is driven by `state`:
//   idle        breathing bob, small arm sway, a blink
//   running     legs and arms cycle, body leans into `lean`
//   jumping     hop with squash and stretch, arms up, feet tucked
//   peeking     tilts out from behind something and back
//   requesting  one arm raised, leaning toward the hub
//   waiting     looks around while something happens
//   cheering    arms up, one small hop
// `selected` adds a ring under the feet. Parents decide the state, scroll
// first, then hover, then idle, so the three never fight.

const PERSONALITY = {
  'claude-code': 'curious', // quick, tilts its head
  claude: 'curious',
  cursor: 'precise', // smooth and exact
  vscode: 'bouncy', // springy, waves
};

export default function AgentCharacter({ agent: key, state = 'idle', selected = false, size = 84, lean = 0, title }) {
  const agent = CLIENTS.find((c) => c.key === key) || CLIENTS[0];
  const { Mark } = agent;
  const tone = agent.tone;
  const id = 'k-ch-' + agent.key;

  return (
    <svg
      className='k-char'
      data-state={state}
      data-selected={selected ? '' : undefined}
      data-personality={PERSONALITY[agent.key] || 'precise'}
      viewBox='0 0 100 124'
      width={(size * 100) / 124}
      height={size}
      style={{ '--tone': tone, '--lean': lean + 'deg' }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
      overflow='visible'
    >
      <defs>
        <linearGradient id={id + '-body'} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#222220' />
          <stop offset='1' stopColor='#121211' />
        </linearGradient>
      </defs>

      <ellipse className='k-char-ring' cx='50' cy='116' rx='30' ry='6' />
      <ellipse className='k-char-shadow' cx='50' cy='116' rx='22' ry='4' />

      <g className='k-char-root'>
        <g className='k-char-legs'>
          <g className='k-char-leg k-char-leg-l'>
            <path d='M41 86 L38 106' />
            <rect x='29' y='104' width='14' height='8' rx='4' />
          </g>
          <g className='k-char-leg k-char-leg-r'>
            <path d='M59 86 L62 106' />
            <rect x='57' y='104' width='14' height='8' rx='4' />
          </g>
        </g>

        <g className='k-char-upper'>
          <g className='k-char-arm k-char-arm-l'>
            <path d='M21 58 Q10 68 12 80' />
            <circle cx='12' cy='82' r='5' />
          </g>
          <g className='k-char-arm k-char-arm-r'>
            <path d='M79 58 Q90 68 88 80' />
            <circle cx='88' cy='82' r='5' />
          </g>

          <rect className='k-char-body' x='17' y='22' width='66' height='68' rx='24' fill={'url(#' + id + '-body)'} />
          <path className='k-char-shine' d='M30 28 Q50 22 70 28' />

          <g className='k-char-eyes'>
            <rect x='37' y='31' width='6.5' height='9' rx='3.25' />
            <rect x='56.5' y='31' width='6.5' height='9' rx='3.25' />
          </g>

          <rect className='k-char-panel' x='31' y='46' width='38' height='38' rx='12' />
          <svg x='36' y='51' width='28' height='28' viewBox='0 0 24 24' className='k-char-mark' style={{ color: tone }}>
            <Mark size={24} />
          </svg>
        </g>
      </g>
    </svg>
  );
}
