import { useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { toast } from 'sonner';

export function ManageSubscription() {
  const { session } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  const handleManage = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || 'Failed to open billing portal');
      }
    } catch {
      toast.error('Failed to open billing portal');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DropdownMenuItem
      onClick={handleManage}
      disabled={isLoading}
      className="cursor-pointer hover:bg-white/5 focus:bg-white/5"
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <CreditCard className="w-4 h-4 mr-2" />
      )}
      Manage Subscription
    </DropdownMenuItem>
  );
}
