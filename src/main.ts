import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks-types'
import * as fs from 'fs'
import * as YAML from 'yaml'
import {EOL} from 'os'
import {Settings, ReviewGatekeeper} from './review_gatekeeper'

async function run(): Promise<void> {
  try {
    const context = github.context
    if (
      context.eventName !== 'pull_request' &&
      context.eventName !== 'pull_request_review'
    ) {
      core.setFailed(
        `Invalid event: ${context.eventName}. This action should be triggered on pull_request and pull_request_review`
      )
      return
    }
    const payload = context.payload as
      | Webhooks.PullRequestEvent
      | Webhooks.PullRequestReviewEvent

    // Read values from config file if it exists
    const config_file = fs.readFileSync(core.getInput('config-file'), 'utf8')

    // Parse contents of config file into variable
    const config_file_contents = YAML.parse(config_file)

    const token: string = core.getInput('token')
    const octokit = github.getOctokit(token)
    const reviews = await octokit.pulls.listReviews({
      ...context.repo,
      pull_number: payload.pull_request.number
    })
    const approved_users: Set<string> = new Set()
    for (const review of reviews.data) {
      if (review.state === `APPROVED`) {
        approved_users.add(review.user!.login)
      }
    }

    const review_gatekeeper = new ReviewGatekeeper(
      config_file_contents as Settings,
      Array.from(approved_users)
    )

    const success = review_gatekeeper.satisfy()
    core.info(`Setting a status on commit (${context.sha})`)

    octokit.repos.createCommitStatus({
      ...context.repo,
      sha: context.sha,
      state: success ? 'success' : 'failure',
      context: 'PR Gatekeeper',
      description: success
        ? undefined
        : review_gatekeeper.getMessages().join(' ').substr(0, 140)
    })

    if (!success) {
      core.setFailed(review_gatekeeper.getMessages().join(EOL))
      return
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
