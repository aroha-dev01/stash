'use client';

import { createContext, useContext, useState } from 'react';
import { clientOf, HERO_AGENTS } from '../_ui/agents';

// Which agent the visitor is watching. Picking one in the hero or the
// ecosystem section switches the demo, the ecosystem example and the connect
// prompt together, so the page tells one story.

const Ctx = createContext(null);

export default function AgentProvider({ children }) {
  const [key, setKey] = useState(HERO_AGENTS[0]);
  return <Ctx.Provider value={{ agent: clientOf(key), setAgent: setKey }}>{children}</Ctx.Provider>;
}

export function useAgent() {
  return useContext(Ctx) || { agent: clientOf(HERO_AGENTS[0]), setAgent: () => {} };
}
