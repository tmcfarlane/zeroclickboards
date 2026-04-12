import { Button } from '@/components/ui/button';
import { User, LogIn, LogOut, ChevronDown, Sparkles } from 'lucide-react';
import { useAuthContext } from './AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { ManageSubscription } from '@/components/billing/ManageSubscription';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface UserProfileProps {
  onSignInClick: () => void;
}

export function UserProfile({ onSignInClick }: UserProfileProps) {
  const { isSignedIn, isLoaded, user, signOut } = useAuthContext();
  const { hasSubscription } = useSubscription();

  if (!isLoaded) {
    return (
      <div className="w-9 h-9 rounded-full bg-white/5 animate-pulse" />
    );
  }

  if (!isSignedIn) {
    return (
      <Button
        onClick={() => {
          onSignInClick();
        }}
        variant="ghost"
        size="sm"
        className="h-9 px-3 text-[#A8B2B2] hover:text-white hover:bg-white/5"
      >
        <LogIn className="w-4 h-4 mr-1.5" />
        Sign In
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-[#A8B2B2] hover:text-white hover:bg-white/5"
        >
          <span className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mr-2 overflow-hidden">
            {user?.user_metadata?.avatar_url ? (
              <img
                src={String(user.user_metadata.avatar_url)}
                alt="User avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <User className="w-4 h-4" />
            )}
          </span>
          <span className="hidden md:inline text-sm max-w-[140px] truncate">
            {user?.email ?? 'Account'}
          </span>
          <ChevronDown className="w-4 h-4 ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-[#111515] border-white/10 text-[#F2F7F7]"
      >
        <div className="px-3 py-2">
          <div className="text-xs text-[#A8B2B2]">Signed in as</div>
          <div className="text-sm font-medium truncate">{user?.email}</div>
        </div>
        {hasSubscription && (
          <>
            <div className="h-px bg-white/10 my-1" />
            <div className="px-3 py-1.5 flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-[#78fcd6]" />
              <span className="text-xs text-[#78fcd6] font-medium">AI Pro</span>
            </div>
            <ManageSubscription />
          </>
        )}
        <div className="h-px bg-white/10 my-1" />
        <DropdownMenuItem
          onClick={async () => {
            await signOut();
          }}
          className="cursor-pointer hover:bg-white/5 focus:bg-white/5"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserProfileSimple() {
  const { isSignedIn, isLoaded, user } = useAuthContext();

  if (!isLoaded || !isSignedIn) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-[#A8B2B2] text-sm">
      <User className="w-4 h-4" />
      <span>{user?.email || 'User'}</span>
    </div>
  );
}
