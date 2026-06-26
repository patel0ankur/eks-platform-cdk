/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState } from 'react';
import {
  Content,
  InfoCard,
  Progress,
  ResponseErrorPanel,
  StatusError,
  StatusOK,
  StatusPending,
  StatusWarning,
  Table,
  TableColumn,
  Link,
} from '@backstage/core-components';
import { useApi } from '@backstage/frontend-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';
import Grid from '@material-ui/core/Grid';
import Button from '@material-ui/core/Button';
import TextField from '@material-ui/core/TextField';
import Typography from '@material-ui/core/Typography';
import { devOpsAgentApiRef } from '../../api';
import {
  getDevOpsAgentSpaceId,
  DEVOPS_AGENT_SPACE_ANNOTATION,
} from '../../annotations';
import {
  Recommendation,
  RecommendationPriority,
} from '../../types';

const priorityStatus = (p: RecommendationPriority) => {
  switch (p) {
    case 'HIGH':
      return <StatusError>High</StatusError>;
    case 'MEDIUM':
      return <StatusWarning>Medium</StatusWarning>;
    default:
      return <StatusPending>Low</StatusPending>;
  }
};

/** Recommendations table for the component's Agent Space. */
const RecommendationsCard = ({ spaceId }: { spaceId: string }) => {
  const api = useApi(devOpsAgentApiRef);
  const { value, loading, error } = useAsync(
    () => api.listRecommendations(spaceId),
    [spaceId],
  );

  if (loading) return <Progress />;
  if (error) return <ResponseErrorPanel error={error} />;

  const columns: TableColumn<Recommendation>[] = [
    { title: 'Priority', field: 'priority', render: r => priorityStatus(r.priority), width: '120px' },
    { title: 'Title', field: 'title' },
    { title: 'Status', field: 'status', width: '160px' },
  ];

  return (
    <InfoCard title="Recommendations">
      <Table<Recommendation>
        options={{ search: false, paging: (value?.length ?? 0) > 5, pageSize: 5, padding: 'dense' }}
        columns={columns}
        data={value ?? []}
        emptyContent={
          <Typography style={{ padding: 16 }}>
            No open recommendations for this service.
          </Typography>
        }
      />
    </InfoCard>
  );
};

/** Recent investigations for the component's Agent Space. */
const InvestigationsCard = ({ spaceId }: { spaceId: string }) => {
  const api = useApi(devOpsAgentApiRef);
  const { value, loading, error } = useAsync(
    () => api.listInvestigations(spaceId),
    [spaceId],
  );

  if (loading) return <Progress />;
  if (error) return <ResponseErrorPanel error={error} />;

  return (
    <InfoCard title="Recent investigations">
      <Table
        options={{ search: false, paging: false, padding: 'dense' }}
        columns={[
          { title: 'Status', field: 'status', width: '140px', render: (r: any) => r.status === 'COMPLETED' ? <StatusOK>{r.status}</StatusOK> : <StatusPending>{r.status ?? 'unknown'}</StatusPending> },
          { title: 'Title', field: 'title' },
          { title: 'Started', field: 'createdAt', width: '200px' },
        ]}
        data={value ?? []}
        emptyContent={
          <Typography style={{ padding: 16 }}>
            No recent investigations.
          </Typography>
        }
      />
    </InfoCard>
  );
};

/** Ask-the-agent chat + start-investigation actions. */
const AgentActionsCard = ({ spaceId }: { spaceId: string }) => {
  const api = useApi(devOpsAgentApiRef);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [investigationMsg, setInvestigationMsg] = useState<string>();

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setErr(undefined);
    setAnswer(undefined);
    try {
      const session = await api.startChat(spaceId);
      const reply = await api.sendMessage(spaceId, session.executionId, question);
      setAnswer(reply.content);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startInvestigation = async () => {
    setBusy(true);
    setErr(undefined);
    setInvestigationMsg(undefined);
    try {
      const result = await api.startInvestigation(spaceId, {
        title: `Manual investigation requested from Backstage`,
        description: `Triggered by a developer from the service's DevOps Agent tab.`,
        priority: 'MEDIUM',
      });
      setInvestigationMsg(
        result.accepted
          ? `Investigation queued (incident ${result.incidentId}).`
          : `Request not accepted: ${result.message ?? 'unknown'}`,
      );
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <InfoCard title="Ask the agent">
      <TextField
        fullWidth
        multiline
        minRows={2}
        variant="outlined"
        placeholder="e.g. Why did latency increase on this service in the last hour?"
        value={question}
        onChange={e => setQuestion(e.target.value)}
        disabled={busy}
      />
      <Grid container spacing={1} style={{ marginTop: 8 }}>
        <Grid item>
          <Button color="primary" variant="contained" onClick={ask} disabled={busy || !question.trim()}>
            Ask
          </Button>
        </Grid>
        <Grid item>
          <Button color="secondary" variant="outlined" onClick={startInvestigation} disabled={busy}>
            Start investigation
          </Button>
        </Grid>
      </Grid>
      {busy && <Progress />}
      {err && <Typography color="error" style={{ marginTop: 8 }}>{err}</Typography>}
      {answer && (
        <Typography component="div" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>
          <strong>Agent:</strong> {answer}
        </Typography>
      )}
      {investigationMsg && (
        <Typography style={{ marginTop: 12 }}>{investigationMsg}</Typography>
      )}
    </InfoCard>
  );
};

/** Shown when an entity has no DevOps Agent Space annotation. */
const NotConfigured = () => (
  <InfoCard title="AWS DevOps Agent">
    <Typography paragraph>
      This component is not linked to an AWS DevOps Agent Space. Add the
      annotation below to its <code>catalog-info.yaml</code> to enable
      recommendations, investigations, and chat for this service.
    </Typography>
    <pre>
      {`metadata:
  annotations:
    ${DEVOPS_AGENT_SPACE_ANNOTATION}: <your-agent-space-id>`}
    </pre>
    <Link to="https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent.html">
      Learn about AWS DevOps Agent
    </Link>
  </InfoCard>
);

export const DevOpsAgentContent = () => {
  const { entity } = useEntity();
  const spaceId = getDevOpsAgentSpaceId(entity);

  if (!spaceId) {
    return (
      <Content>
        <NotConfigured />
      </Content>
    );
  }

  return (
    <Content>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <RecommendationsCard spaceId={spaceId} />
        </Grid>
        <Grid item xs={12} md={6}>
          <AgentActionsCard spaceId={spaceId} />
        </Grid>
        <Grid item xs={12}>
          <InvestigationsCard spaceId={spaceId} />
        </Grid>
      </Grid>
    </Content>
  );
};