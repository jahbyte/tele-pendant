import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** Unknown addresses (e.g. /operator/xyz) — not a blank shell. */
export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileQuestion className="size-5 text-muted-foreground" />
            Page not found
          </CardTitle>
          <CardDescription>
            That address is not a Tele-Pendant screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/operator">Operator</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
