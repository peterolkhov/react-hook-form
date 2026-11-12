// Diagnostic fixture only: src/__tests__/useForm/state42-resetField.test.tsx.
// Freeze this file for both independent before and after runs.
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { Resolver } from '../../types';
import { useForm } from '../../useForm';

type Values = { itemCode: string; batchCode: string };
type Name = keyof Values;

function deferred() {
  let resolve!: (value: true | string) => void;
  const promise = new Promise<true | string>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function finiteCompletion(operations: Promise<boolean>[]) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(operations),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Local validation did not settle')), 2000);
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

describe.each(['built-in', 'resolver'] as const)(
  'resetField pending %s validation',
  (kind) => {
    it.each(['field', 'whole-form', 'none'] as const)(
      'keeps cancelled errors discarded and unrelated results active: reset=%s',
      async (resetKind) => {
        const requests = { itemCode: deferred(), batchCode: deferred() };
        const started: { name: Name; value: string }[] = [];
        const operations: Promise<boolean>[] = [];
        const messages = { itemCode: 'Item is discontinued', batchCode: 'Batch is closed' };
        const defaults: Values = { itemCode: 'current-item', batchCode: 'current-batch' };
        const check = async (name: Name, value: string) => {
          if (value === defaults[name]) return true;
          started.push({ name, value });
          return await requests[name].promise;
        };
        const resolver: Resolver<Values> = async (values, _context, options) => {
          const snapshot = { ...values };
          const errors: Record<string, { type: string; message: string }> = {};
          for (const name of options.names as Name[]) {
            const result = await check(name, snapshot[name]);
            if (result !== true) errors[name] = { type: 'validate', message: result };
          }
          return Object.keys(errors).length
            ? { values: {}, errors }
            : { values: snapshot, errors: {} };
        };
        function Editor() {
          const { register, trigger, resetField, reset, formState: { errors } } = useForm<Values>({
            defaultValues: defaults,
            ...(kind === 'resolver' ? { resolver } : {}),
          });
          return <form>
            <label>Item<input {...register('itemCode', kind === 'built-in' ? {
              validate: async (value) => await check('itemCode', value),
            } : undefined)} /></label>
            <label>Batch<input {...register('batchCode', kind === 'built-in' ? {
              validate: async (value) => await check('batchCode', value),
            } : undefined)} /></label>
            <button type="button" onClick={() => { operations.push(trigger('itemCode')); }}>Check item</button>
            <button type="button" onClick={() => { operations.push(trigger('batchCode')); }}>Check batch</button>
            <button type="button" onClick={() => {
              if (resetKind === 'field') resetField('itemCode');
              if (resetKind === 'whole-form') reset();
            }}>Cancel item</button>
            <output aria-label="item error">{errors.itemCode?.message || 'none'}</output>
            <output aria-label="batch error">{errors.batchCode?.message || 'none'}</output>
          </form>;
        }
        const rendered = () => ({
          itemValue: (screen.getByRole('textbox', { name: 'Item' }) as HTMLInputElement).value,
          batchValue: (screen.getByRole('textbox', { name: 'Batch' }) as HTMLInputElement).value,
          itemError: screen.getByLabelText('item error').textContent,
          batchError: screen.getByLabelText('batch error').textContent,
        });
        try {
          render(<Editor />);
          const initial = rendered();
          expect(initial).toEqual({ itemValue: defaults.itemCode, batchValue: defaults.batchCode, itemError: 'none', batchError: 'none' });
          fireEvent.change(screen.getByRole('textbox', { name: 'Item' }), { target: { value: 'retired-item' } });
          fireEvent.change(screen.getByRole('textbox', { name: 'Batch' }), { target: { value: 'closed-batch' } });
          fireEvent.click(screen.getByRole('button', { name: 'Check item' }));
          fireEvent.click(screen.getByRole('button', { name: 'Check batch' }));
          const pending = rendered();
          expect(started).toEqual([{ name: 'itemCode', value: 'retired-item' }, { name: 'batchCode', value: 'closed-batch' }]);
          expect(operations).toHaveLength(2);
          expect(pending).toEqual({ itemValue: 'retired-item', batchValue: 'closed-batch', itemError: 'none', batchError: 'none' });
          fireEvent.click(screen.getByRole('button', { name: 'Cancel item' }));
          const afterCancel = rendered();
          expect(afterCancel).toEqual({
            itemValue: resetKind === 'none' ? 'retired-item' : defaults.itemCode,
            batchValue: resetKind === 'whole-form' ? defaults.batchCode : 'closed-batch',
            itemError: 'none', batchError: 'none',
          });
          await act(async () => {
            requests.itemCode.resolve(messages.itemCode);
            requests.batchCode.resolve(messages.batchCode);
            await finiteCompletion(operations);
          });
          const settled = rendered();
          console.log('STATE42_NATIVE_RECEIPT ' + JSON.stringify({ kind, resetKind, started, operationCount: operations.length, initial, pending, afterCancel, settled }));
          expect(settled.itemValue).toBe(resetKind === 'none' ? 'retired-item' : defaults.itemCode);
          expect(settled.batchValue).toBe(resetKind === 'whole-form' ? defaults.batchCode : 'closed-batch');
          expect(settled.itemError).toBe(resetKind === 'none' ? messages.itemCode : 'none');
          expect(settled.batchError).toBe(resetKind === 'whole-form' ? 'none' : messages.batchCode);
        } finally {
          requests.itemCode.resolve(messages.itemCode);
          requests.batchCode.resolve(messages.batchCode);
          await act(async () => { await finiteCompletion(operations); });
        }
      },
    );
  },
);
