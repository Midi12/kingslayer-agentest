/**
 * Turning probability vectors into Jev answers, exactly in the `SystemOneResult` shape of
 * the SDK. Confidence is (n·p_max − 1)/(n − 1), the formula the LocalNavigator uses
 * (ADR M03-jev-fake): 0 for a uniform distribution, 1 for a certain one.
 */
import type {
  ChoiceAnswer,
  EntryType,
  JevAnswer,
  JevQuestion,
  NoulAnswer,
  ScoreAnswer,
} from './types.js';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** (n·p_max − 1)/(n − 1) over a distribution of n values; 1 when n is 1. */
export function choiceConfidence(probabilities: readonly number[]): number {
  const n = probabilities.length;
  if (n <= 1) {
    return 1;
  }
  const max = Math.max(...probabilities);
  return clamp01((n * max - 1) / (n - 1));
}

/** Scales non-negative weights to sum to 1; all-zero weights become uniform. */
export function normalize(weights: readonly number[]): number[] {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (weights.length === 0) {
    return [];
  }
  if (!(sum > 0)) {
    return weights.map(() => 1 / weights.length);
  }
  return weights.map((weight) => weight / sum);
}

/** Index of the largest value; the first one wins a tie. */
export function argmax(values: readonly number[]): number {
  let best = 0;
  values.forEach((value, index) => {
    if (value > (values[best] ?? -Infinity)) {
      best = index;
    }
  });
  return best;
}

export function choiceLabels(question: Extract<JevQuestion, { type: 'choice' }>): string[] {
  return Object.keys(question.criteria);
}

export function choiceAnswer(
  labels: readonly string[],
  probabilities: readonly number[],
): ChoiceAnswer {
  const p = normalize(probabilities);
  const record: Record<string, number> = {};
  labels.forEach((label, index) => {
    record[label] = p[index] ?? 0;
  });
  return {
    type: 'choice',
    choice: labels[argmax(p)] ?? '',
    confidence: choiceConfidence(p),
    probabilities: record,
  };
}

export function noulAnswer(probability: number): NoulAnswer {
  return { type: 'noul', noul: clamp01(probability) };
}

export function scoreAnswer(
  criteria: readonly EntryType[],
  probabilities: readonly number[],
): ScoreAnswer {
  const p = normalize(probabilities);
  const legend: Record<string, EntryType> = {};
  const record: Record<string, number> = {};
  criteria.forEach((description, index) => {
    legend[String(index)] = description;
    record[String(index)] = p[index] ?? 0;
  });
  const score = p.reduce((total, probability, index) => total + probability * index, 0);
  return {
    type: 'score',
    score,
    confidence: choiceConfidence(p),
    legend,
    probabilities: record,
  };
}

/** A distribution over n values with `confidence` on index `pick` and the rest shared equally. */
export function distributionWithConfidence(n: number, pick: number, confidence: number): number[] {
  if (n <= 1) {
    return [1];
  }
  const top = (clamp01(confidence) * (n - 1) + 1) / n;
  const rest = (1 - top) / (n - 1);
  return Array.from({ length: n }, (_, index) => (index === pick ? top : rest));
}

/** The uniform answer to a question: what Jev would say knowing nothing. */
export function uniformAnswer(question: JevQuestion): JevAnswer {
  switch (question.type) {
    case 'choice': {
      const labels = Object.keys(question.criteria);
      return choiceAnswer(
        labels,
        labels.map(() => 1),
      );
    }
    case 'noul':
      return noulAnswer(0.5);
    case 'score':
      return scoreAnswer(
        question.criteria,
        question.criteria.map(() => 1),
      );
  }
}
