/** The shell plugin's configuration page: the limits every command the agent runs is bound by. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NumericValueField, ValueField } from './fields.tsx'
import { PluginConfigForm } from './PluginConfigForm.tsx'
import type { BashCardFace } from './bash-card-controller.ts'

/** Props the renderer binds for the shell page. */
export type BashCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<BashCardFace>

/**
 * Render the shell plugin's one-liner or its configuration form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function BashCard(props: BashCardProps) {
  const { t } = props
  const state = props.useBashCard(snapshot => snapshot)
  if (props.view === 'summary') return t('bashDescription')
  const disabled = !state.writable
  return (
    <PluginConfigForm
      t={t}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {/* jscpd:ignore-start -- rows restate the shared NumericValueField props */}
      <NumericValueField
        id="plugin-config-bash-timeout"
        label={t('bashTimeoutMs')}
        hint={t('bashTimeoutMsHint')}
        copy={{ overridden: t('overridden'), reset: t('reset'), invalidNumber: t('invalidNumber') }}
        disabled={disabled}
        field={state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }}
        onReset={() => { props.resetField('timeoutMs') }}
      />
      {/* jscpd:ignore-end */}
      <ValueField
        id="plugin-config-bash-output"
        label={t('bashMaxOutputBytes')}
        hint={t('bashMaxOutputBytesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxOutputBytes}
        onEdit={(text) => { props.edit('maxOutputBytes', text) }}
        onReset={() => { props.resetField('maxOutputBytes') }}
      />
    </PluginConfigForm>
  )
}
