import SiteHeader from '../_ui/SiteHeader';
import SignIn from './signin';

export const metadata = { title: 'Sign in' };

export default function Login() {
  return (
    <div className='k'>
      <SiteHeader current='login' />
      <main className='k-auth'>
        <SignIn />
      </main>
    </div>
  );
}
