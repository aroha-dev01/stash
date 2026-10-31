'use client';

import Link from 'next/link';
import { track } from './track';

/** A link that records one funnel event when followed. For server-rendered pages. */
export default function TrackedLink({ event, props, ...rest }) {
  return <Link {...rest} onClick={() => track(event, props)} />;
}
