import { PRO } from '@/lib/plans';
import { GlobeIcon, PersonIcon, SparkIcon } from './icons';

// Who can open an entry, as a word with an icon: never colour alone.
const LABEL = {
  public: ['Public', GlobeIcon, 'Anyone can open this'],
  free: ['Members', PersonIcon, 'Free with a Stash account'],
  premium: [PRO.name, SparkIcon, 'Part of ' + PRO.name],
};

export default function AccessBadge({ tier = 'public', quiet = false }) {
  const [label, Icon, title] = LABEL[tier] || LABEL.public;
  return (
    <span className={'k-access k-access-' + tier + (quiet ? ' k-access-quiet' : '')} title={title}>
      <Icon />
      {label}
    </span>
  );
}
