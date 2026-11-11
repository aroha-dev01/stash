import Link from 'next/link';
import { PRO, FREE } from '@/lib/plans';
import { countProjects } from '@/lib/projects';
import { TONES } from '@/lib/projectTemplates';
import { SparkIcon } from '../_ui/icons';
import ProjectMap from './ProjectMap';
import HowItWorks from './HowItWorks';

// What a Free member sees at /projects: what the feature does, drawn with a
// sample project, and the one step that opens it. Nothing of anyone's real
// data. A member who left Premium is told their projects are kept.

const SAMPLE = [
  { id: 's1', name: 'Frontend', tone: TONES.amber, count: 5 },
  { id: 's2', name: 'Backend', tone: TONES.sky, count: 4 },
  { id: 's3', name: 'UI/UX design', tone: TONES.lilac, count: 3 },
  { id: 's4', name: 'Auth & payments', tone: TONES.coral, count: 2 },
  { id: 's5', name: 'Content & SEO', tone: TONES.sand, count: 3 },
];

export default async function PremiumGate({ viewer, back = '/projects' }) {
  const kept = await countProjects(viewer.id).catch(() => 0);

  return (
    <>
      <div className='k-section-head' style={{ marginBottom: 0 }}>
        <span className='k-eyebrow'>{PRO.name} · Projects</span>
        <h1 className='k-h1' style={{ fontSize: 'var(--text-page)' }}>One project. The same skills, every session.</h1>
        <p className='k-lede'>
          Make a project for each thing you build, file the skills it needs into folders like Frontend, Backend and UI/UX,
          and tell your agent which project you are on. It works from your picks instead of choosing afresh each time.
        </p>
      </div>

      <section className='k-pj-gate' aria-labelledby='gate-h'>
        <div className='k-pj-gate-map' aria-hidden='true'>
          <ProjectMap name='ABC website' folders={SAMPLE} height={340} />
        </div>
        <div className='k-pj-gate-copy'>
          <span className='k-locked-icon'><SparkIcon size={18} /></span>
          <h2 id='gate-h' className='k-h2' style={{ fontSize: 'clamp(26px, 3vw, 34px)' }}>Projects are part of {PRO.name}</h2>
          <p className='k-muted' style={{ margin: 0 }}>
            {kept
              ? 'Your ' + kept + (kept === 1 ? ' project is' : ' projects are') + ' kept exactly as you left ' + (kept === 1 ? 'it' : 'them') + '. ' + PRO.name + ' opens ' + (kept === 1 ? 'it' : 'them') + ' again, on the web and in your agent.'
              : PRO.name + ' opens the whole library, AI recommendations and projects your agent can work from, for ' + PRO.price + ' ' + PRO.period + '.'}
          </p>
          <div className='k-locked-acts'>
            <Link className='k-btn k-btn-accent' href={'/upgrade?back=' + encodeURIComponent(back)}>Explore {PRO.name}</Link>
            <Link className='k-btn' href='/explore'>Continue with {FREE.name}</Link>
          </div>
        </div>
      </section>

      <HowItWorks />
    </>
  );
}
