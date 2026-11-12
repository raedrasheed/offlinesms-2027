import type { Metadata } from 'next';
import RegistrationForm from './RegistrationForm';

export const metadata: Metadata = {
  title: 'Apply for an organization account',
};

export default function BusinessRegistrationPage() {
  return <RegistrationForm />;
}
