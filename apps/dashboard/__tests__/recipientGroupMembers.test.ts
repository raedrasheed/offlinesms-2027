import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RecipientGroupMembers from '../app/admin/organization-messaging/RecipientGroupMembers';

const { act, create } = require('react-test-renderer');
const first = { name: 'مَرْيَم', phone: '+970595550123' };
const second = { name: 'Alex', phone: '+972595550123' };
const third = { name: 'Omar', phone: '+970595550124' };
const members = [first, second, third];
const manageAction = vi.fn();
const onMembersChanged = vi.fn();
const confirmRemoval = vi.fn();
let view: ReturnType<typeof create>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { confirm: confirmRemoval });
  await act(async () => {
    view = create(createElement(RecipientGroupMembers, { groupId: 'parents', members, manageAction, onMembersChanged }));
  });
});

afterEach(async () => {
  await act(async () => view.unmount());
  vi.unstubAllGlobals();
});

it('searches Arabic names and digits and limits bulk removal to confirmed, visible selections', async () => {
  const search = () => view.root.findByProps({ type: 'search' });
  const names = () => view.root.findAllByType('bdi').map((node: { children: string[] }) => node.children.join(''));
  const deleteSelected = () => view.root.findAllByType('button').find((node: { children: string[] }) => node.children[0] === 'Delete selected');
  const selectAll = () => view.root.findByProps({ 'aria-label': 'Select all shown recipients' });

  await act(async () => search().props.onChange({ target: { value: 'مريم' } }));
  expect(names()).toEqual([first.name]);
  await act(async () => selectAll().props.onChange({ target: { checked: true } }));
  await act(async () => search().props.onChange({ target: { value: '٩٧٢' } }));
  expect(names()).toEqual([second.name]);
  expect(deleteSelected().props.disabled).toBe(true);

  await act(async () => search().props.onChange({ target: { value: '' } }));
  await act(async () => view.root.findByType('select').props.onChange({ target: { value: '970' } }));
  expect(names()).toEqual([first.name, third.name]);
  await act(async () => selectAll().props.onChange({ target: { checked: true } }));
  confirmRemoval.mockReturnValueOnce(false).mockReturnValueOnce(true);
  manageAction.mockResolvedValue({ members: [second] });
  await act(async () => deleteSelected().props.onClick());
  expect(manageAction).not.toHaveBeenCalled();
  await act(async () => deleteSelected().props.onClick());
  expect(manageAction).toHaveBeenCalledOnce();
  expect(manageAction).toHaveBeenCalledWith('parents', { type: 'delete', recipients: [first, third] });
  expect(onMembersChanged).toHaveBeenCalledOnce();
  await act(async () => view.root.findByType('select').props.onChange({ target: { value: '' } }));
  expect(names()).toEqual([second.name]);
});

it('saves both edited fields and removes an individual recipient on confirmation', async () => {
  const edited = { name: 'Alex Morgan', phone: '+12025550123' };
  await act(async () => view.root.findByProps({ 'aria-label': `Edit ${second.name} (${second.phone})` }).props.onClick());
  await act(async () => view.root.findByProps({ maxLength: 120 }).props.onChange({ target: { value: edited.name } }));
  await act(async () => view.root.findByProps({ type: 'tel' }).props.onChange({ target: { value: edited.phone } }));
  manageAction.mockResolvedValueOnce({ members: [first, edited, third] });
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }));
  expect(manageAction).toHaveBeenNthCalledWith(1, 'parents', { type: 'edit', original: second, recipient: edited });

  confirmRemoval.mockReturnValue(true);
  manageAction.mockResolvedValueOnce({ members: [first, third] });
  await act(async () => view.root.findByProps({ 'aria-label': `Delete ${edited.name} (${edited.phone})` }).props.onClick());
  expect(manageAction).toHaveBeenNthCalledWith(2, 'parents', { type: 'delete', recipients: [edited] });
  expect(onMembersChanged).toHaveBeenCalledTimes(2);
});
