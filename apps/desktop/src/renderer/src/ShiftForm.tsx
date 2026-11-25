import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ShiftTemplateDto } from '../../shared/ipc';
import { ShiftTimeline, type TimelineShape } from './ShiftTimeline';
import { WfDialog, WfField } from './WfDialog';
import {
  DAY_MIN,
  clockText,
  dayShift,
  errorText,
  nearestOffset,
  parseClock,
} from './workforceShared';

interface FormState {
  name: string;
  active: boolean;
  start: string;
  end: string;
  inFrom: string;
  inTo: string;
  outFrom: string;
  outTo: string;
  openEnded: boolean;
  lateGraceMin: string;
  otCapMin: string;
  reason: string;
}

type FieldKey =
  | 'name'
  | 'start'
  | 'end'
  | 'inFrom'
  | 'inTo'
  | 'outFrom'
  | 'outTo'
  | 'lateGraceMin'
  | 'otCapMin'
  | 'reason';

const fromTemplate = (item: ShiftTemplateDto): FormState => ({
  name: item.name,
  active: item.active,
  start: clockText(item.startMin),
  end: clockText(item.endMin),
  inFrom: clockText(item.inFromMin),
  inTo: clockText(item.inToMin),
  outFrom: clockText(item.endMin - item.checkoutOpenBeforeEndMin),
  outTo: clockText(item.outToMin ?? item.endMin + 60),
  openEnded: item.outToMin === null,
  lateGraceMin: String(item.lateGraceMin),
  otCapMin: String(item.otCapMin),
  reason: '',
});

const blank: FormState = {
  name: '',
  active: true,
  start: '10:00',
  end: '22:00',
  inFrom: '09:40',
  inTo: '11:00',
  outFrom: '21:40',
  outTo: '23:00',
  openEnded: false,
  lateGraceMin: '0',
  otCapMin: '480',
  reason: '',
};

const shiftClock = (value: string, delta: number): string => {
  const clock = parseClock(value);
  return clock === null ? value : clockText(clock + delta);
};

const wholeMinutes = (value: string, max: number): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return parsed <= max ? parsed : null;
};

/** Converts the HH:mm form into the minute-offset model (offsets from the shift start date midnight). */
const toModel = (form: FormState) => {
  const errors: Partial<Record<FieldKey, string>> = {};
  const start = parseClock(form.start);
  const endClock = parseClock(form.end);
  if (start === null) errors.start = 'wf.shiftForm.errors.time';
  if (endClock === null) errors.end = 'wf.shiftForm.errors.time';
  if (!form.name.trim()) errors.name = 'wf.shiftForm.errors.name';
  const lateGraceMin = wholeMinutes(form.lateGraceMin, 720);
  if (lateGraceMin === null) errors.lateGraceMin = 'wf.shiftForm.errors.grace';
  const otCapMin = wholeMinutes(form.otCapMin, 1440);
  if (otCapMin === null) errors.otCapMin = 'wf.shiftForm.errors.otCap';
  if (start === null || endClock === null) return { errors, model: null };
  const startMin = start;
  const endMin = endClock > start ? endClock : endClock + DAY_MIN;
  const clocks = {
    inFrom: parseClock(form.inFrom),
    inTo: parseClock(form.inTo),
    outFrom: parseClock(form.outFrom),
    outTo: parseClock(form.outTo),
  };
  for (const key of ['inFrom', 'inTo', 'outFrom'] as const) {
    if (clocks[key] === null) errors[key] = 'wf.shiftForm.errors.time';
  }
  if (!form.openEnded && clocks.outTo === null) errors.outTo = 'wf.shiftForm.errors.time';
  if (clocks.inFrom === null || clocks.inTo === null || clocks.outFrom === null)
    return { errors, model: null };
  const inFromMin = nearestOffset(clocks.inFrom, startMin);
  const inToMin = nearestOffset(clocks.inTo, startMin);
  const outFromMin = nearestOffset(clocks.outFrom, endMin);
  const outToMin =
    form.openEnded || clocks.outTo === null ? null : nearestOffset(clocks.outTo, endMin);
  const checkoutOpenBeforeEndMin = endMin - outFromMin;
  if (inFromMin > inToMin) errors.inTo = 'wf.shiftForm.errors.inOrder';
  if (checkoutOpenBeforeEndMin < 0) errors.outFrom = 'wf.shiftForm.errors.outAfterEnd';
  else if (checkoutOpenBeforeEndMin > 720) errors.outFrom = 'wf.shiftForm.errors.outTooEarly';
  else if (inToMin >= outFromMin) errors.outFrom = 'wf.shiftForm.errors.windowsOverlap';
  if (outToMin !== null && outToMin < outFromMin) errors.outTo = 'wf.shiftForm.errors.outOrder';
  const effectiveOutEnd = outToMin ?? endMin + (otCapMin ?? 0);
  if (effectiveOutEnd >= inFromMin + DAY_MIN) {
    if (outToMin === null) errors.otCapMin = 'wf.shiftForm.errors.nextDayOverlap';
    else errors.outTo = 'wf.shiftForm.errors.nextDayOverlap';
  }
  return {
    errors,
    model: {
      startMin,
      endMin,
      inFromMin,
      inToMin,
      outFromMin,
      outToMin,
      checkoutOpenBeforeEndMin,
      lateGraceMin: lateGraceMin ?? 0,
      otCapMin: otCapMin ?? 0,
      effectiveOutEnd,
    },
  };
};

const serverFieldFor: Record<string, FieldKey> = {
  EMPTY_NAME: 'name',
  INVALID_SHIFT_RANGE: 'end',
  INVALID_IN_WINDOW: 'inTo',
  INVALID_OUT_WINDOW: 'outTo',
  WINDOWS_OVERLAP: 'outFrom',
  ADJACENT_DAY_WINDOWS_OVERLAP: 'outTo',
};

interface Props {
  template: ShiftTemplateDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export const ShiftForm = ({ template, onClose, onSaved }: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(template ? fromTemplate(template) : blank);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const { errors: clientErrors, model } = toModel(form);
  const errors: Partial<Record<FieldKey, string>> = { ...serverErrors, ...clientErrors };
  if (template && touched && !form.reason.trim()) errors.reason = 'wf.common.reasonRequired';
  const visibleError = (key: FieldKey): string | undefined =>
    errors[key] && (touched || key !== 'name') ? t(errors[key]) : undefined;

  const update = (patch: Partial<FormState>): void => {
    setServerErrors({});
    setForm((current) => ({ ...current, ...patch }));
  };
  const changeStart = (value: string): void => {
    const before = parseClock(form.start);
    const after = parseClock(value);
    const delta = before !== null && after !== null ? after - before : 0;
    update({
      start: value,
      inFrom: shiftClock(form.inFrom, delta),
      inTo: shiftClock(form.inTo, delta),
    });
  };
  const changeEnd = (value: string): void => {
    const before = parseClock(form.end);
    const after = parseClock(value);
    const delta = before !== null && after !== null ? after - before : 0;
    update({
      end: value,
      outFrom: shiftClock(form.outFrom, delta),
      outTo: shiftClock(form.outTo, delta),
    });
  };
  const suggest = (): void => {
    update({
      inFrom: shiftClock(form.start, -20),
      inTo: shiftClock(form.start, 60),
      outFrom: shiftClock(form.end, -20),
      outTo: shiftClock(form.end, 60),
    });
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setTouched(true);
    setMessage('');
    const hasErrors =
      Object.keys(clientErrors).length > 0 || (template !== null && !form.reason.trim());
    if (hasErrors || !model) return;
    if (!window.dawam) {
      onSaved();
      return;
    }
    const input = {
      name: form.name.trim(),
      active: form.active,
      startMin: model.startMin,
      endMin: model.endMin,
      inFromMin: model.inFromMin,
      inToMin: model.inToMin,
      outFromMin: model.outFromMin,
      outToMin: model.outToMin,
      lateGraceMin: model.lateGraceMin,
      checkoutOpenBeforeEndMin: model.checkoutOpenBeforeEndMin,
      otCapMin: model.otCapMin,
      reason: template ? form.reason.trim() : 'Initial shift template',
    };
    setSaving(true);
    const result = template
      ? await window.dawam.workforce.updateTemplate({ id: template.id, ...input })
      : await window.dawam.workforce.createTemplate(input);
    setSaving(false);
    if (!result.ok) {
      const mapped: Partial<Record<FieldKey, string>> = {};
      for (const code of result.error.details ?? []) {
        const field = serverFieldFor[code];
        if (field) mapped[field] = `wf.shiftForm.serverErrors.${code}`;
      }
      setServerErrors(mapped);
      setMessage(errorText(result.error, t));
      return;
    }
    onSaved();
  };

  const dayBadge = (offset: number | undefined): React.ReactNode => {
    if (offset === undefined) return null;
    const day = dayShift(offset);
    if (day === 0) return <span className="wf-day-badge">{t('wf.shiftForm.sameDay')}</span>;
    return (
      <span className={`wf-day-badge ${day > 0 ? 'next' : 'prev'}`}>
        {day > 0 ? t('wf.shiftForm.nextDay') : t('wf.shiftForm.previousDay')}
      </span>
    );
  };
  const shape: TimelineShape | null = model
    ? {
        startMin: model.startMin,
        endMin: model.endMin,
        inFromMin: model.inFromMin,
        inToMin: Math.max(model.inFromMin, model.inToMin),
        outFromMin: model.outFromMin,
        outEndMin: Math.max(model.outFromMin, model.effectiveOutEnd),
        lateGraceMin: model.lateGraceMin,
        openEnded: model.outToMin === null,
      }
    : null;
  const duration = model ? model.endMin - model.startMin : 0;

  return (
    <WfDialog
      title={
        template ? t('wf.shiftForm.editTitle', { name: template.name }) : t('wf.shiftForm.addTitle')
      }
      subtitle={t('wf.shiftForm.subtitle')}
      onClose={onClose}
      onSubmit={(event) => void submit(event)}
      footer={
        <>
          <button type="button" className="wf-button ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="wf-button primary" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      {message && (
        <div className="wf-alert danger" role="alert">
          {message}
        </div>
      )}
      <div className="wf-shift-preview">
        <div className="wf-shift-preview-head">
          <strong>{t('wf.shiftForm.livePreview')}</strong>
          {model && (
            <span>
              <bdi>
                {clockText(model.startMin)} → {clockText(model.endMin)}
              </bdi>
              {model.endMin >= DAY_MIN && (
                <em className="wf-day-badge next">{t('wf.shiftForm.plusOne')}</em>
              )}
              {' · '}
              {t('wf.shiftForm.duration', {
                hours: Math.floor(duration / 60),
                minutes: String(duration % 60).padStart(2, '0'),
              })}
            </span>
          )}
          <button type="button" className="wf-button ghost small" onClick={suggest}>
            {t('wf.shiftForm.suggest')}
          </button>
        </div>
        {shape ? (
          <ShiftTimeline shape={shape} />
        ) : (
          <p className="wf-muted">{t('wf.shiftForm.errors.time')}</p>
        )}
      </div>

      <div className="wf-form-grid">
        <fieldset className="wf-group">
          <legend>{t('wf.shiftForm.groups.shift')}</legend>
          <div className="wf-group-grid">
            <WfField
              label={t('shifts.name')}
              htmlFor="shift-name"
              error={visibleError('name')}
              wide
            >
              <input
                id="shift-name"
                autoFocus
                value={form.name}
                maxLength={100}
                aria-invalid={Boolean(visibleError('name'))}
                onChange={(e) => update({ name: e.target.value })}
              />
            </WfField>
            <WfField label={t('shifts.start')} htmlFor="shift-start" error={visibleError('start')}>
              <input
                id="shift-start"
                type="time"
                value={form.start}
                onChange={(e) => changeStart(e.target.value)}
              />
            </WfField>
            <WfField
              label={t('shifts.end')}
              htmlFor="shift-end"
              error={visibleError('end')}
              badge={dayBadge(model?.endMin)}
              hint={t('wf.shiftForm.endHint')}
            >
              <input
                id="shift-end"
                type="time"
                value={form.end}
                onChange={(e) => changeEnd(e.target.value)}
              />
            </WfField>
            <WfField
              label={t('wf.shiftForm.lateGrace')}
              htmlFor="shift-grace"
              error={visibleError('lateGraceMin')}
              hint={t('wf.shiftForm.lateGraceHint')}
            >
              <input
                id="shift-grace"
                type="number"
                min="0"
                max="720"
                inputMode="numeric"
                value={form.lateGraceMin}
                onChange={(e) => update({ lateGraceMin: e.target.value })}
              />
            </WfField>
            <label className="wf-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => update({ active: e.target.checked })}
              />
              <span>{t('shifts.active')}</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="wf-group">
          <legend>{t('wf.shiftForm.groups.windows')}</legend>
          <div className="wf-group-grid">
            <WfField
              label={t('wf.shiftForm.inFrom')}
              htmlFor="shift-in-from"
              error={visibleError('inFrom')}
              badge={dayBadge(model?.inFromMin)}
            >
              <input
                id="shift-in-from"
                type="time"
                value={form.inFrom}
                onChange={(e) => update({ inFrom: e.target.value })}
              />
            </WfField>
            <WfField
              label={t('wf.shiftForm.inTo')}
              htmlFor="shift-in-to"
              error={visibleError('inTo')}
              badge={dayBadge(model?.inToMin)}
            >
              <input
                id="shift-in-to"
                type="time"
                value={form.inTo}
                onChange={(e) => update({ inTo: e.target.value })}
              />
            </WfField>
            <WfField
              label={t('wf.shiftForm.outFrom')}
              htmlFor="shift-out-from"
              error={visibleError('outFrom')}
              badge={dayBadge(model?.outFromMin)}
              hint={
                model && model.checkoutOpenBeforeEndMin >= 0
                  ? t('wf.shiftForm.outFromHint', { minutes: model.checkoutOpenBeforeEndMin })
                  : undefined
              }
            >
              <input
                id="shift-out-from"
                type="time"
                value={form.outFrom}
                onChange={(e) => update({ outFrom: e.target.value })}
              />
            </WfField>
            <WfField
              label={t('wf.shiftForm.outTo')}
              htmlFor="shift-out-to"
              error={visibleError('outTo')}
              badge={form.openEnded ? undefined : dayBadge(model?.outToMin ?? undefined)}
              hint={form.openEnded ? t('wf.shiftForm.openEndedHint') : undefined}
            >
              <input
                id="shift-out-to"
                type="time"
                value={form.outTo}
                disabled={form.openEnded}
                onChange={(e) => update({ outTo: e.target.value })}
              />
            </WfField>
            <label className="wf-check wide">
              <input
                type="checkbox"
                checked={form.openEnded}
                onChange={(e) => update({ openEnded: e.target.checked })}
              />
              <span>{t('wf.shiftForm.openEnded')}</span>
            </label>
            <WfField
              label={t('wf.shiftForm.otCap')}
              htmlFor="shift-ot-cap"
              error={visibleError('otCapMin')}
              hint={t('wf.shiftForm.otCapHint')}
            >
              <input
                id="shift-ot-cap"
                type="number"
                min="0"
                max="1440"
                inputMode="numeric"
                disabled={!form.openEnded}
                value={form.otCapMin}
                onChange={(e) => update({ otCapMin: e.target.value })}
              />
            </WfField>
          </div>
        </fieldset>
      </div>

      <ul className="wf-help-list">
        <li>{t('wf.shiftForm.help.firstLast')}</li>
        <li>{t('wf.shiftForm.help.late')}</li>
        <li>{t('wf.shiftForm.help.overtime')}</li>
        <li>{t('wf.shiftForm.help.midnight')}</li>
      </ul>

      {template && (
        <WfField
          label={t('common.reason')}
          htmlFor="shift-reason"
          error={visibleError('reason')}
          wide
        >
          <input
            id="shift-reason"
            value={form.reason}
            maxLength={500}
            onChange={(e) => update({ reason: e.target.value })}
          />
        </WfField>
      )}
    </WfDialog>
  );
};
