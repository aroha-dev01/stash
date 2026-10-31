// The plans as members see them. Rename a plan or change its price here and
// the pricing page, locked states, account page and MCP messages follow.

export const FREE = { key: 'free', name: 'Free', price: '$0', period: null };

export const PRO = {
  key: 'pro',
  name: 'Premium',
  price: '$1',
  period: 'per month',
  // No checkout yet: curators grant Pro from /admin. Flip this when payments open.
  checkoutOpen: false,
};

export const proLine = () => PRO.name + ' (' + PRO.price + (PRO.period ? ' ' + PRO.period : '') + ')';
