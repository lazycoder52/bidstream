import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateAuctionDtoSchema, CreateAuctionDto } from '@bidstream/contracts';
import { auctionsApi, ApiClientError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, ArrowLeft, PlusCircle, ShieldAlert } from 'lucide-react';

export const CreateAuctionPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  // Default times: Start Now, End in 2 hours
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 1000).toISOString().slice(0, 16);
  const defaultEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateAuctionDto>({
    resolver: zodResolver(CreateAuctionDtoSchema),
    defaultValues: {
      title: '',
      description: '',
      startingPrice: 50,
      minIncrement: 5,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
  });

  const onSubmit = async (data: CreateAuctionDto) => {
    setServerError(null);
    try {
      const created = await auctionsApi.create({
        ...data,
        startTime: new Date(data.startTime).toISOString(),
        endTime: new Date(data.endTime).toISOString(),
      });
      navigate(`/auctions/${created.id}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setServerError(err.message);
      } else {
        setServerError('Failed to create auction listing. Please try again.');
      }
    }
  };

  if (!user || (user.role !== 'SELLER' && user.role !== 'ADMIN')) {
    return (
      <div className="max-w-md mx-auto my-12 text-center p-8 border rounded-xl bg-card">
        <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold">Seller Access Required</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Only registered sellers can create auction listings. You are currently signed in as a{' '}
          <span className="font-semibold capitalize">{user?.role?.toLowerCase() || 'Guest'}</span>.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/auctions">
            <Button variant="outline">Browse Auctions</Button>
          </Link>
          <Link to="/register">
            <Button>Register as Seller</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Link
        to="/auctions"
        className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to auctions
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Create New Auction Listing</CardTitle>
          <CardDescription>
            List an item with automated anti-sniping protection and serialized transactional
            bidding.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {serverError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{serverError}</span>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">Listing Title</Label>
              <Input
                id="title"
                placeholder="e.g. Vintage 1974 Mechanical Chronograph Watch"
                {...register('title')}
              />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="description">Detailed Description</Label>
              <textarea
                id="description"
                rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Describe condition, specifications, provenance, and included accessories..."
                {...register('description')}
              />
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description.message}</p>
              )}
            </div>

            {/* Starting Price & Minimum Increment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startingPrice">Starting Price ($)</Label>
                <Input
                  id="startingPrice"
                  type="number"
                  step="any"
                  placeholder="50"
                  {...register('startingPrice')}
                />
                {errors.startingPrice && (
                  <p className="text-xs text-destructive">{errors.startingPrice.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="minIncrement">Minimum Bid Increment ($)</Label>
                <Input
                  id="minIncrement"
                  type="number"
                  step="any"
                  placeholder="5"
                  {...register('minIncrement')}
                />
                {errors.minIncrement && (
                  <p className="text-xs text-destructive">{errors.minIncrement.message}</p>
                )}
              </div>
            </div>

            {/* Reserve Price (Optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="reservePrice" className="flex items-center justify-between">
                <span>Reserve Price ($)</span>
                <span className="text-xs text-muted-foreground font-normal">Optional</span>
              </Label>
              <Input
                id="reservePrice"
                type="number"
                step="any"
                placeholder="Hidden minimum price required to award listing"
                {...register('reservePrice')}
              />
              {errors.reservePrice && (
                <p className="text-xs text-destructive">{errors.reservePrice.message}</p>
              )}
            </div>

            {/* Start and End Times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="startTime">Start Date & Time</Label>
                <Input
                  id="startTime"
                  type="datetime-local"
                  defaultValue={defaultStart}
                  {...register('startTime')}
                />
                {errors.startTime && (
                  <p className="text-xs text-destructive">{errors.startTime.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="endTime">End Date & Time</Label>
                <Input
                  id="endTime"
                  type="datetime-local"
                  defaultValue={defaultEnd}
                  {...register('endTime')}
                />
                {errors.endTime && (
                  <p className="text-xs text-destructive">{errors.endTime.message}</p>
                )}
              </div>
            </div>
          </CardContent>

          <CardFooter className="flex justify-end gap-3 pt-4 border-t">
            <Link to="/auctions">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              <PlusCircle className="h-4 w-4" />
              {isSubmitting ? 'Publishing...' : 'Publish Listing'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};
