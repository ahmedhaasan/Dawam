import { useTranslation } from 'react-i18next';

import { DAY_MIN, clockText, minuteLabel } from './workforceShared';

export interface TimelineShape {
  startMin: number;
  endMin: number;
  inFromMin: number;
  inToMin: number;
  /** Effective checkout opening (end − checkout-open-before-end). */
  outFromMin: number;
  /** Effective end of the accepted checkout zone. */
  outEndMin: number;
  lateGraceMin: number;
  openEnded: boolean;
}

export const timelineRange = (shapes: readonly TimelineShape[]): [number, number] => {
  if (shapes.length === 0) return [0, DAY_MIN];
  const low = Math.min(...shapes.map((shape) => Math.min(shape.inFromMin, shape.startMin)));
  const high = Math.max(...shapes.map((shape) => Math.max(shape.outEndMin, shape.endMin)));
  let from = Math.floor((low - 60) / 180) * 180;
  let to = Math.ceil((high + 60) / 180) * 180;
  if (to - from < 720) {
    const pad = Math.ceil((720 - (to - from)) / 360) * 180;
    from -= pad;
    to += pad;
  }
  return [from, to];
};

interface Props {
  shape: TimelineShape;
  range?: [number, number];
  compact?: boolean;
}

export const ShiftTimeline = ({ shape, range, compact = false }: Props): React.JSX.Element => {
  const { t } = useTranslation();
  const [from, to] = range ?? timelineRange([shape]);
  const span = Math.max(1, to - from);
  const pct = (value: number): number => Math.min(100, Math.max(0, ((value - from) / span) * 100));
  const segment = (start: number, end: number): React.CSSProperties => ({
    insetInlineStart: `${pct(start)}%`,
    inlineSize: `${Math.max(0.6, pct(end) - pct(start))}%`,
  });
  const tickStep = compact ? 360 : span > 1800 ? 360 : 180;
  const ticks: number[] = [];
  for (let value = Math.ceil(from / tickStep) * tickStep; value <= to; value += tickStep) {
    ticks.push(value);
  }
  const midnights: number[] = [];
  for (let value = Math.ceil(from / DAY_MIN) * DAY_MIN; value <= to; value += DAY_MIN) {
    if (value > from && value < to) midnights.push(value);
  }
  const graceEnd = shape.startMin + shape.lateGraceMin;
  const summary = t('wf.timeline.aria', {
    start: minuteLabel(shape.startMin),
    end: minuteLabel(shape.endMin),
    inFrom: minuteLabel(shape.inFromMin),
    inTo: minuteLabel(shape.inToMin),
    outFrom: minuteLabel(shape.outFromMin),
    outTo: minuteLabel(shape.outEndMin),
  });

  return (
    <div className={`wf-timeline${compact ? ' compact' : ''}`} role="img" aria-label={summary}>
      <div className="wf-tl-track">
        {midnights.map((value) => (
          <span
            className="wf-tl-midnight"
            key={value}
            style={{ insetInlineStart: `${pct(value)}%` }}
          >
            {!compact && <em>{t('wf.timeline.nextDay')}</em>}
          </span>
        ))}
        <div className="wf-tl-lane shift-lane">
          <span
            className="wf-tl-seg shift"
            style={segment(shape.startMin, shape.endMin)}
            title={`${t('wf.timeline.shift')}: ${minuteLabel(shape.startMin)} → ${minuteLabel(shape.endMin)}`}
          >
            {!compact && (
              <bdi>
                {clockText(shape.startMin)} → {clockText(shape.endMin)}
              </bdi>
            )}
          </span>
          {shape.lateGraceMin > 0 && (
            <span
              className="wf-tl-seg grace"
              style={segment(shape.startMin, graceEnd)}
              title={`${t('wf.timeline.grace')}: ${minuteLabel(graceEnd)}`}
            />
          )}
          <span
            className="wf-tl-late-marker"
            style={{ insetInlineStart: `${pct(graceEnd)}%` }}
            title={`${t('wf.timeline.lateFrom')} ${minuteLabel(graceEnd)}`}
          />
        </div>
        <div className="wf-tl-lane window-lane">
          <span
            className="wf-tl-seg in"
            style={segment(shape.inFromMin, shape.inToMin)}
            title={`${t('wf.timeline.checkIn')}: ${minuteLabel(shape.inFromMin)} – ${minuteLabel(shape.inToMin)}`}
          />
          <span
            className={`wf-tl-seg out${shape.openEnded ? ' open' : ''}`}
            style={segment(shape.outFromMin, shape.outEndMin)}
            title={`${t('wf.timeline.checkOut')}: ${minuteLabel(shape.outFromMin)} – ${minuteLabel(shape.outEndMin)}`}
          />
        </div>
      </div>
      <div className="wf-tl-axis" aria-hidden="true">
        {ticks.map((value) => (
          <span key={value} style={{ insetInlineStart: `${pct(value)}%` }}>
            <bdi>{clockText(value)}</bdi>
          </span>
        ))}
      </div>
      {!compact && (
        <ul className="wf-tl-legend">
          <li>
            <i className="shift" /> {t('wf.timeline.shift')}
          </li>
          <li>
            <i className="grace" /> {t('wf.timeline.grace')}
          </li>
          <li>
            <i className="in" /> {t('wf.timeline.checkIn')}
          </li>
          <li>
            <i className="out" /> {t('wf.timeline.checkOut')}
          </li>
          {shape.openEnded && (
            <li>
              <i className="out open" /> {t('wf.timeline.openEnded')}
            </li>
          )}
          <li>
            <i className="midnight" /> {t('wf.timeline.midnight')}
          </li>
        </ul>
      )}
    </div>
  );
};
