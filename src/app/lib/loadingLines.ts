// What the big loader says while something loads: short, playful, and still honest about what's
// happening. One set per area; `general` fills in anywhere else.
export type LoadingContext = 'general' | 'agent' | 'agents' | 'inbox' | 'tickets' | 'contacts' | 'broadcasts' | 'analytics' | 'whatsapp' | 'settings' | 'home'

export const LOADING_LINES: Record<LoadingContext, string[]> = {
  general: ['Cooking something up…', 'Hold tight, it’s loading era…', 'No cap, almost there…', 'Fetching the good stuff…', 'Brb, talking to the servers…'],
  agent: ['Loading your agent’s whole lore…', 'Syncing with Meta, it’s giving teamwork…', 'Waking your agent up, give it a sec…', 'Pulling its brain from the cloud…', 'Main character agent incoming…'],
  agents: ['Rounding up your AI agents…', 'Checking who’s on shift…', 'Asking Meta for the roster…', 'Your agents are fixing their fits…'],
  inbox: ['Catching up on the group chat…', 'Reading the DMs (respectfully)…', 'Fetching the tea from WhatsApp…', 'Who texted? Finding out…'],
  tickets: ['Lining up the tickets…', 'Checking what’s overdue, no judgement…', 'Sorting the drama by priority…', 'Counting the clocks…'],
  contacts: ['Gathering the squad…', 'Loading everyone you’ve vibed with…', 'Checking the guest list…'],
  broadcasts: ['Warming up the megaphone…', 'Pulling your templates from WhatsApp…', 'Checking what went out and who read it…'],
  analytics: ['Crunching the numbers, big brain time…', 'Making the charts slap…', 'Doing the maths so you don’t have to…'],
  whatsapp: ['Pinging WhatsApp…', 'Checking your numbers’ glow-up…', 'Asking Meta how your numbers are doing…'],
  settings: ['Loading the control room…', 'Finding all the knobs and switches…', 'Getting the team list…'],
  home: ['Getting your day sorted…', 'Checking your WhatsApp setup…', 'Seeing what needs you today…'],
}
