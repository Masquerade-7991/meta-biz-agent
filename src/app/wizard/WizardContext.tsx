import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { SliceKey, StepId, StudioSectionId, WizardState } from './types'
import { DEFAULT_BUSINESS_HOURS, DEFAULT_REPLIES } from './mockData'

const STORAGE_KEY = 'meta-agent-wizard-state-v1'

export function createInitialState(): WizardState {
  return {
    gate: {
      selectedWabaId: null,
      selectedPhoneNumber: null,
      selectedWabaName: null,
      pin: '',
      pinAttempted: false,
      pinError: null,
      registrationComplete: false,
      billingAttached: false,
      gatePassed: false,
    },
    currentStep: 'agent',
    completedSteps: {
      agent: false,
      knowledge: false,
      connections: false,
      safety: false,
      publish: false,
    },
    identity: {
      agentName: '',
      companyName: '',
      agentRole: '',
      capabilities: [],
      exclusionsOpen: false,
      exclusions: '',
      avatarDataUrl: null,
      persona: null,
    },
    business: {
      businessDescription: '',
      paymentMethods: [],
      paymentOtherText: '',
      paymentSource: null,
      paymentPlainText: '',
      returnPolicy: '',
      purchaseInfo: '',
      deliveryAndShipping: '',
      contactEmail: '',
      businessAddress: '',
      businessHours: DEFAULT_BUSINESS_HOURS,
      businessHoursEnabled: false,
    },
    knowledge: {
      faqs: [],
      documents: [],
      websites: [],
      lastFaqImport: null,
    },
    personalization: {
      tone: 'professional',
      customToneInstructions: '',
      emojiUse: 'sparingly',
      nameIntroduction: false,
      answerLength: 'standard',
      defaultLanguage: 'English',
      additionalLanguages: [],
      matchCustomerLanguage: true,
      allowMixedLanguage: false,
      customSkills: [],
      lastSkillImport: null,
    },
    richReplies: {
      richReplies: [],
    },
    routing: {
      journeyProfile: null,
      selectedTemplateIds: [],
      intents: [],
      fallbackBehaviour: 'escalate',
    },
    connectors: {
      connectorType: null,
      apiKey: '',
      clientId: '',
      clientSecret: '',
      connectionStatus: 'untested',
      tools: [],
      customTools: [],
      skipped: false,
    },
    connections: {
      connections: [],
      actions: [],
      activity: [],
    },
    integrations: {
      installed: [],
    },
    mcp: {
      connection: null,
    },
    guardrails: {
      groundingMode: 'strict',
      neverSayPhrases: [],
      topicsToAvoid: [],
      handoffMessageEnabled: false,
      handoffMessage: '',
    },
    replies: {
      greetingReply: DEFAULT_REPLIES.greetingReply,
      wrapUpHelpful: DEFAULT_REPLIES.wrapUpHelpful,
      wrapUpUnhelpful: DEFAULT_REPLIES.wrapUpUnhelpful,
      offerHumanHandover: true,
      fallbackReply: DEFAULT_REPLIES.fallbackReply,
      outOfHoursReply: DEFAULT_REPLIES.outOfHoursReply,
      unsupportedMediaReply: DEFAULT_REPLIES.unsupportedMediaReply,
      followUpEnabled: false,
      followUpInterval: 0,
      followUpMessage: DEFAULT_REPLIES.followUpMessage,
    },
    publish: {
      versionNote: '',
      approverRequired: false,
      pendingApproval: false,
      billingConfirmed: false,
      testRunStatus: 'idle',
      testResults: [],
      testsStaleSince: null,
      metaEval: {
        available: false,
        avgConversationScore: 0,
        avgTurnScore: 0,
        summary: '',
        failureCategories: [],
      },
      allowlistNumbers: [],
      audienceMode: 'allowlisted',
      activated: false,
      activatedChannels: [],
    },
    qualityChecks: {
      runs: [],
    },
    agentEvents: {
      configured: false,
      webhookUrl: '',
      secretKey: '',
      secretRevealed: false,
      eventTypes: [],
      events: [],
    },
    demo: {
      businessCategory: 'Retail',
      forceNextFailure: false,
      richRepliesForceSaveFailure: false,
      simulateMultipleLanguages: false,
    },
    lastEditedAt: {
      gate: 0,
      identity: 0,
      business: 0,
      knowledge: 0,
      personalization: 0,
      richReplies: 0,
      routing: 0,
      connectors: 0,
      connections: 0,
      integrations: 0,
      mcp: 0,
      guardrails: 0,
      replies: 0,
      publish: 0,
      qualityChecks: 0,
      agentEvents: 0,
      demo: 0,
    },
    pendingSkillPrefill: null,
    pendingStepFocus: null,
    currentSection: 'overview',
  }
}

type Updater<K extends SliceKey> = Partial<WizardState[K]> | ((prev: WizardState[K]) => Partial<WizardState[K]>)

type Action =
  | { type: 'PATCH_SLICE'; slice: SliceKey; patch: Updater<SliceKey> }
  | { type: 'SET_STEP'; step: StepId }
  | { type: 'SET_STEP_COMPLETE'; step: StepId; complete: boolean }
  | { type: 'SET_SECTION'; section: StudioSectionId }
  | { type: 'INVALIDATE_TESTS' }
  | { type: 'SET_PENDING_SKILL_PREFILL'; value: WizardState['pendingSkillPrefill'] }
  | { type: 'SET_PENDING_STEP_FOCUS'; value: WizardState['pendingStepFocus'] }
  | { type: 'RESET' }

// Slices whose edits bump lastEditedAt and can mark saved tests stale. `gate` and `demo` are
// prototype/setup concerns, not agent configuration, so they're excluded — same as before.
const EDITABLE_SLICES: SliceKey[] = [
  'identity',
  'business',
  'knowledge',
  'personalization',
  'richReplies',
  'routing',
  'connectors',
  'connections',
  'integrations',
  'mcp',
  'guardrails',
  'replies',
]

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case 'PATCH_SLICE': {
      const resolvedPatch =
        typeof action.patch === 'function' ? action.patch(state[action.slice]) : action.patch
      const next: WizardState = {
        ...state,
        [action.slice]: { ...state[action.slice], ...resolvedPatch },
      }
      if (EDITABLE_SLICES.includes(action.slice)) {
        next.lastEditedAt = { ...next.lastEditedAt, [action.slice]: Date.now() }
        if (next.publish.testResults.length > 0 && !next.publish.testsStaleSince) {
          next.publish = { ...next.publish, testsStaleSince: Date.now() }
        }
      }
      return next
    }
    case 'SET_STEP':
      return { ...state, currentStep: action.step }
    case 'SET_SECTION':
      return { ...state, currentSection: action.section }
    case 'SET_STEP_COMPLETE':
      return {
        ...state,
        completedSteps: { ...state.completedSteps, [action.step]: action.complete },
      }
    case 'INVALIDATE_TESTS':
      return {
        ...state,
        publish: { ...state.publish, testsStaleSince: Date.now() },
      }
    case 'SET_PENDING_SKILL_PREFILL':
      return { ...state, pendingSkillPrefill: action.value }
    case 'SET_PENDING_STEP_FOCUS':
      return { ...state, pendingStepFocus: action.value }
    case 'RESET':
      return createInitialState()
    default:
      return state
  }
}

/** Fields added to persisted slices after a user's browser already had saved state need a
 *  default here — otherwise old localStorage data loads with that field missing and crashes
 *  whatever first reads it, since TypeScript's shape guarantee doesn't apply to parsed JSON. */
function migrateKnowledge(knowledge: WizardState['knowledge'] | undefined): WizardState['knowledge'] | undefined {
  if (!knowledge?.websites) return knowledge
  return { ...knowledge, websites: knowledge.websites.map((w) => ({ ...w, subpages: w.subpages ?? [] })) }
}

function loadInitialState(): WizardState {
  if (typeof window === 'undefined') return createInitialState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialState()
    const parsed = JSON.parse(raw) as WizardState
    return { ...createInitialState(), ...parsed, knowledge: migrateKnowledge(parsed.knowledge) ?? createInitialState().knowledge }
  } catch {
    return createInitialState()
  }
}

interface WizardContextValue {
  state: WizardState
  patch: <K extends SliceKey>(slice: K, patch: Updater<K>) => void
  setStep: (step: StepId) => void
  setStepComplete: (step: StepId, complete: boolean) => void
  setSection: (section: StudioSectionId) => void
  setPendingSkillPrefill: (value: WizardState['pendingSkillPrefill']) => void
  setPendingStepFocus: (value: WizardState['pendingStepFocus']) => void
  resetWizard: () => void
}

const WizardContext = createContext<WizardContextValue | null>(null)

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = useMemo<WizardContextValue>(
    () => ({
      state,
      patch: (slice, patch) =>
        dispatch({ type: 'PATCH_SLICE', slice, patch: patch as Updater<SliceKey> }),
      setStep: (step) => dispatch({ type: 'SET_STEP', step }),
      setStepComplete: (step, complete) => dispatch({ type: 'SET_STEP_COMPLETE', step, complete }),
      setSection: (section) => dispatch({ type: 'SET_SECTION', section }),
      setPendingSkillPrefill: (value) => dispatch({ type: 'SET_PENDING_SKILL_PREFILL', value }),
      setPendingStepFocus: (value) => dispatch({ type: 'SET_PENDING_STEP_FOCUS', value }),
      resetWizard: () => dispatch({ type: 'RESET' }),
    }),
    [state],
  )

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
}

export function useWizard() {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used within WizardProvider')
  return ctx
}
